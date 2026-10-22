import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { NativeSelect } from '@/components/native-select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  createRecurrence,
  type DayRule,
  type NonBusinessDayPolicy,
  type Recurrence,
  type RecurrenceDirection,
  updateRecurrence,
} from '@/http/recurrences'
import { listAccounts } from '@/http/transactions'
import { parseReaisToCents } from '@/lib/money'
import { zodResolver } from '@/lib/zod-resolver'

const MAX_DAY: Record<DayRule, number> = {
  DAY_OF_MONTH: 31,
  NTH_BUSINESS_DAY: 23,
}

const schema = z
  .object({
    description: z.string().trim().min(1, { message: 'Descrição obrigatória' }),
    accountId: z.string().min(1, { message: 'Escolha a conta' }),
    direction: z.enum(['IN', 'OUT']),
    amount: z.string().refine((v) => parseReaisToCents(v) !== null, {
      message: 'Informe um valor válido',
    }),
    dayRule: z.enum(['DAY_OF_MONTH', 'NTH_BUSINESS_DAY']),
    dayValue: z.string().trim(),
    policy: z.enum(['ANTICIPATE', 'POSTPONE', 'KEEP']),
  })
  .superRefine((data, ctx) => {
    const max = MAX_DAY[data.dayRule]
    const n = Number(data.dayValue)
    if (!/^\d+$/.test(data.dayValue) || n < 1 || n > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayValue'],
        message: `Informe um dia de 1 a ${max}`,
      })
    }
  })

type FormData = z.infer<typeof schema>

/** Centavos em "1234,56" para o campo de valor (sem separador de milhar). */
function centsToInput(cents: number): string {
  const abs = Math.abs(cents)
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

const DIRECTION_LABELS: Record<RecurrenceDirection, string> = {
  IN: 'Entrada',
  OUT: 'Saída',
}

function RecurrenceFormBody({
  recurrence,
  onDone,
}: {
  recurrence?: Recurrence
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: recurrence?.description ?? '',
      accountId: recurrence?.accountId ?? '',
      direction: recurrence?.direction ?? 'OUT',
      amount: recurrence ? centsToInput(recurrence.expectedAmountCents) : '',
      dayRule: recurrence?.dayRule ?? 'DAY_OF_MONTH',
      dayValue: recurrence?.dayValue.toString() ?? '',
      policy: recurrence?.nonBusinessDayPolicy ?? 'ANTICIPATE',
    },
  })
  const dayRule = watch('dayRule')

  const save = useMutation({
    mutationFn: async (data: FormData) => {
      const cents = parseReaisToCents(data.amount)
      if (cents === null) return
      const rule = {
        description: data.description.trim(),
        expectedAmountCents: cents,
        dayRule: data.dayRule,
        dayValue: Number(data.dayValue),
        nonBusinessDayPolicy: data.policy as NonBusinessDayPolicy,
      }
      if (recurrence) {
        // PATCH é estrito: sem accountId/direction. Só sugerida vira confirmada.
        await updateRecurrence(recurrence.id, {
          ...rule,
          ...(recurrence.status === 'SUGGESTED' && { status: 'CONFIRMED' }),
        })
      } else {
        await createRecurrence({
          ...rule,
          accountId: data.accountId,
          direction: data.direction,
        })
      }
    },
    onSuccess: async () => {
      await Promise.all(
        ['recurrences', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      onDone()
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível salvar. Tente novamente.',
        ),
      ),
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((data) => save.mutate(data))}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rec-description">Descrição</Label>
        <Input id="rec-description" {...register('description')} />
        {errors.description && (
          <p role="alert" className="text-destructive text-sm">
            {errors.description.message}
          </p>
        )}
      </div>

      {recurrence ? (
        <p className="text-muted-foreground text-sm">
          {`${recurrence.account.name} · ${DIRECTION_LABELS[recurrence.direction]}`}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-account">Conta</Label>
            <NativeSelect id="rec-account" {...register('accountId')}>
              <option value="">Selecione</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {errors.accountId && (
              <p role="alert" className="text-destructive text-sm">
                {errors.accountId.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-direction">Direção</Label>
            <NativeSelect id="rec-direction" {...register('direction')}>
              <option value="OUT">Saída</option>
              <option value="IN">Entrada</option>
            </NativeSelect>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rec-amount">Valor (R$)</Label>
        <Input
          id="rec-amount"
          inputMode="decimal"
          placeholder="0,00"
          {...register('amount')}
        />
        {errors.amount && (
          <p role="alert" className="text-destructive text-sm">
            {errors.amount.message}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-rule">Regra</Label>
          <NativeSelect id="rec-rule" {...register('dayRule')}>
            <option value="DAY_OF_MONTH">Todo dia X</option>
            <option value="NTH_BUSINESS_DAY">Nº dia útil</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-day">Dia</Label>
          <Input
            id="rec-day"
            inputMode="numeric"
            aria-invalid={errors.dayValue ? true : undefined}
            {...register('dayValue')}
          />
          {errors.dayValue && (
            <p role="alert" className="text-destructive text-sm">
              {errors.dayValue.message}
            </p>
          )}
        </div>
      </div>

      {dayRule === 'DAY_OF_MONTH' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-policy">
            Se cair em fim de semana ou feriado
          </Label>
          <NativeSelect id="rec-policy" {...register('policy')}>
            <option value="ANTICIPATE">Antecipar</option>
            <option value="POSTPONE">Adiar</option>
            <option value="KEEP">Manter</option>
          </NativeSelect>
        </div>
      )}

      <DialogFooter>
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Formulário em dialog: cria um recorrente, ou confirma/edita `recurrence`. */
export function RecurrenceFormDialog({
  open,
  onOpenChange,
  recurrence,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recurrence?: Recurrence
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {recurrence?.status === 'SUGGESTED'
              ? 'Confirmar recorrente'
              : recurrence
                ? 'Editar recorrente'
                : 'Novo recorrente'}
          </DialogTitle>
          <DialogDescription>
            Lançamento que se repete todo mês.
          </DialogDescription>
        </DialogHeader>
        <RecurrenceFormBody
          recurrence={recurrence}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
