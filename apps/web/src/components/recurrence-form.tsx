import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
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
  listRecurrences,
  type NonBusinessDayPolicy,
  type Recurrence,
  type RecurrenceDirection,
  type RecurrenceKind,
  type UpdateRecurrenceInput,
  updateRecurrence,
} from '@/http/recurrences'
import { listAccounts } from '@/http/transactions'
import { parseReaisToCents } from '@/lib/money'
import { zodResolver } from '@/lib/zod-resolver'

const MAX_DAY: Record<DayRule, number> = {
  DAY_OF_MONTH: 31,
  NTH_BUSINESS_DAY: 23,
}

const MAX_INSTALLMENTS = 600

export const KIND_LABELS: Record<RecurrenceKind, string> = {
  MONTHLY: 'Mensal',
  LOAN: 'Empréstimo',
  EXTERNAL: 'Fora da Pluggy',
}

/** Saída que pode vir abatida do salário: empréstimo ou mensal (plano de saúde, sindicato). */
function canBePayroll(data: {
  kind: RecurrenceKind
  direction: RecurrenceDirection
}) {
  return data.kind !== 'EXTERNAL' && data.direction === 'OUT'
}

/** Descontado em folha: sai do salário, sem conta e sempre como saída. */
function isPayroll(data: {
  kind: RecurrenceKind
  direction: RecurrenceDirection
  payroll: boolean
}) {
  return canBePayroll(data) && data.payroll
}

const schema = z
  .object({
    kind: z.enum(['MONTHLY', 'LOAN', 'EXTERNAL']),
    description: z.string().trim().min(1, { message: 'Descrição obrigatória' }),
    // Vazio = qualquer conta.
    accountId: z.string(),
    direction: z.enum(['IN', 'OUT']),
    amount: z.string().refine((v) => parseReaisToCents(v) !== null, {
      message: 'Informe um valor válido',
    }),
    dayRule: z.enum(['DAY_OF_MONTH', 'NTH_BUSINESS_DAY']),
    dayValue: z.string().trim(),
    policy: z.enum(['ANTICIPATE', 'POSTPONE', 'KEEP']),
    remaining: z.string().trim(),
    payroll: z.boolean(),
    // Vazio = sem recebimento para escolher (o dia é informado à mão).
    payrollSourceId: z.string(),
  })
  .superRefine((data, ctx) => {
    const max = MAX_DAY[data.dayRule]
    const n = Number(data.dayValue)
    const followsSalary = isPayroll(data) && data.payrollSourceId !== ''
    if (!followsSalary && (!/^\d+$/.test(data.dayValue) || n < 1 || n > max)) {
      ctx.addIssue({
        code: 'custom',
        path: ['dayValue'],
        message: `Informe um dia de 1 a ${max}`,
      })
    }
    const remaining = Number(data.remaining)
    if (
      data.kind === 'LOAN' &&
      data.remaining !== '' &&
      (!/^\d+$/.test(data.remaining) ||
        remaining < 1 ||
        remaining > MAX_INSTALLMENTS)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['remaining'],
        message: `Informe de 1 a ${MAX_INSTALLMENTS} parcelas`,
      })
    }
  })

type FormData = z.infer<typeof schema>

/** Centavos em "1234,56" para o campo de valor (sem separador de milhar). */
function centsToInput(cents: number): string {
  const abs = Math.abs(cents)
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/**
 * Na edição vão só tipo, conta e parcelas que mudaram: reenviar as parcelas
 * regravaria o dia em que foram informadas e desfaria o desconto dos vínculos.
 */
/** O salário principal: o de maior valor com "salario" no texto, ou o maior recebimento. */
function defaultPayrollSource(incomes: Recurrence[]): Recurrence | undefined {
  const salaries = incomes.filter((i) => /salario|salário/i.test(i.description))
  const pool = salaries.length > 0 ? salaries : incomes
  return [...pool].sort(
    (a, b) => b.expectedAmountCents - a.expectedAmountCents,
  )[0]
}

function changedFields(
  recurrence: Recurrence,
  data: FormData,
): UpdateRecurrenceInput {
  const payroll = isPayroll(data)
  const accountId =
    data.kind === 'EXTERNAL' || payroll ? null : data.accountId || null
  const remaining =
    data.kind === 'LOAN' && data.remaining !== ''
      ? Number(data.remaining)
      : null
  return {
    ...(data.kind !== recurrence.kind && { kind: data.kind }),
    ...(accountId !== recurrence.accountId && { accountId }),
    ...(payroll !== recurrence.payrollDeduction && {
      payrollDeduction: payroll,
    }),
    ...(payroll &&
      data.payrollSourceId !== '' &&
      data.payrollSourceId !== recurrence.payrollSourceId && {
        payrollSourceId: data.payrollSourceId,
      }),
    ...(data.kind === 'LOAN' &&
      remaining !== recurrence.remainingInstallments && {
        remainingInstallments: remaining,
      }),
  }
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  )
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
  // Mesma consulta da página: os recebimentos de que o empréstimo em folha pode sair.
  const recurrences = useQuery({
    queryKey: ['recurrences'],
    queryFn: listRecurrences,
  })
  const incomes =
    recurrences.data?.filter(
      (r) =>
        r.kind === 'MONTHLY' &&
        r.direction === 'IN' &&
        r.status === 'CONFIRMED',
    ) ?? []

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: recurrence?.kind ?? 'MONTHLY',
      description: recurrence?.description ?? '',
      accountId: recurrence?.accountId ?? '',
      direction: recurrence?.direction ?? 'OUT',
      amount: recurrence ? centsToInput(recurrence.expectedAmountCents) : '',
      dayRule: recurrence?.dayRule ?? 'DAY_OF_MONTH',
      dayValue: recurrence?.dayValue.toString() ?? '',
      policy: recurrence?.nonBusinessDayPolicy ?? 'ANTICIPATE',
      remaining: recurrence?.remainingInstallments?.toString() ?? '',
      payroll: recurrence?.payrollDeduction ?? false,
      payrollSourceId: recurrence?.payrollSourceId ?? '',
    },
  })
  const dayRule = watch('dayRule')
  const kind = watch('kind')
  const direction = watch('direction')
  const payroll = isPayroll({ kind, direction, payroll: watch('payroll') })
  const payrollSourceId = watch('payrollSourceId')
  const fallbackSource = defaultPayrollSource(incomes)
  const source = incomes.find((i) => i.id === payrollSourceId)
  const followsSalary = payroll && source !== undefined
  // A direção identifica o recorrente (não muda na edição) e a folha é sempre saída.
  const lockedDirection: RecurrenceDirection | null = recurrence
    ? recurrence.direction
    : payroll
      ? 'OUT'
      : null

  // Sem escolha, o salário principal (o mesmo que a API usaria).
  useEffect(() => {
    if (payroll && payrollSourceId === '' && fallbackSource) {
      setValue('payrollSourceId', fallbackSource.id)
    }
  }, [payroll, payrollSourceId, fallbackSource, setValue])

  const save = useMutation({
    mutationFn: async (data: FormData) => {
      const cents = parseReaisToCents(data.amount)
      if (cents === null) return
      // Em folha, o vencimento é o do salário de que é descontado.
      const salary = isPayroll(data)
        ? incomes.find((i) => i.id === data.payrollSourceId)
        : undefined
      const rule = {
        description: data.description.trim(),
        expectedAmountCents: cents,
        dayRule: salary?.dayRule ?? data.dayRule,
        dayValue: salary?.dayValue ?? Number(data.dayValue),
        nonBusinessDayPolicy:
          salary?.nonBusinessDayPolicy ?? (data.policy as NonBusinessDayPolicy),
      }
      if (recurrence) {
        // Só sugerida vira confirmada; o sentido não muda.
        await updateRecurrence(recurrence.id, {
          ...rule,
          ...(recurrence.status === 'SUGGESTED' && { status: 'CONFIRMED' }),
          ...changedFields(recurrence, data),
        })
      } else {
        const payrollLoan = isPayroll(data)
        await createRecurrence({
          kind: data.kind,
          ...(data.kind !== 'EXTERNAL' &&
            !payrollLoan &&
            data.accountId && { accountId: data.accountId }),
          ...rule,
          direction: payrollLoan ? 'OUT' : data.direction,
          ...(data.kind === 'LOAN' &&
            data.remaining !== '' && {
              remainingInstallments: Number(data.remaining),
            }),
          ...(payrollLoan && { payrollDeduction: true }),
          ...(salary && { payrollSourceId: salary.id }),
        })
      }
    },
    onSuccess: async () => {
      await Promise.all(
        ['recurrences', 'recurrence', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      toast.success('Recorrente salvo.')
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

  // A projeção ignora recorrente no cartão; o atual continua na lista para não sumir da edição.
  const accountOptions = accounts.data?.filter(
    (a) =>
      a.type === 'BANK' ||
      a.type === 'WALLET' ||
      a.id === recurrence?.accountId,
  )

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((data) => save.mutate(data))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-kind">Tipo</Label>
          <NativeSelect id="rec-kind" {...register('kind')}>
            {(Object.keys(KIND_LABELS) as RecurrenceKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-direction">Direção</Label>
          {lockedDirection ? (
            // Fora do formulário: campo desabilitado não manda valor no envio.
            <NativeSelect
              id="rec-direction"
              disabled
              value={lockedDirection}
              aria-describedby="rec-direction-hint"
              onChange={() => {}}
            >
              <option value="OUT">Saída</option>
              <option value="IN">Entrada</option>
            </NativeSelect>
          ) : (
            <NativeSelect id="rec-direction" {...register('direction')}>
              <option value="OUT">Saída</option>
              <option value="IN">Entrada</option>
            </NativeSelect>
          )}
          {lockedDirection && (
            <p
              id="rec-direction-hint"
              className="text-muted-foreground text-xs"
            >
              {recurrence
                ? 'Não muda depois de criado.'
                : 'Desconto em folha é sempre saída.'}
            </p>
          )}
        </div>
      </div>

      {canBePayroll({ kind, direction }) && (
        <div className="flex items-start gap-2">
          <input
            id="rec-payroll"
            type="checkbox"
            className="accent-primary mt-0.5 size-4"
            {...register('payroll')}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="rec-payroll">Descontado em folha</Label>
            <p className="text-muted-foreground text-xs">
              Já vem abatido do salário: o crédito do salário é vinculado e o
              valor fica fora do "A pagar".
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rec-description">Descrição</Label>
        <Input id="rec-description" {...register('description')} />
        <FieldError message={errors.description?.message} />
      </div>

      {kind !== 'EXTERNAL' && !payroll && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-account">Conta</Label>
          {accountOptions ? (
            // Montado só com as opções: o valor salvo precisa existir para aparecer selecionado.
            <NativeSelect id="rec-account" {...register('accountId')}>
              <option value="">Qualquer conta</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <NativeSelect id="rec-account" disabled aria-busy="true">
              <option>Carregando contas…</option>
            </NativeSelect>
          )}
          <p className="text-muted-foreground text-xs">
            Só informação: o vínculo vale para transações de qualquer conta.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-amount">Valor (R$)</Label>
          <Input
            id="rec-amount"
            inputMode="decimal"
            placeholder="0,00"
            {...register('amount')}
          />
          <FieldError message={errors.amount?.message} />
        </div>
        {kind === 'LOAN' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rec-remaining">Parcelas que faltam</Label>
            <Input
              id="rec-remaining"
              inputMode="numeric"
              placeholder="Opcional"
              aria-invalid={errors.remaining ? true : undefined}
              {...register('remaining')}
            />
            <FieldError message={errors.remaining?.message} />
          </div>
        )}
      </div>

      {payroll && incomes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rec-payroll-source">Descontado de</Label>
          <NativeSelect
            id="rec-payroll-source"
            {...register('payrollSourceId')}
          >
            {incomes.map((i) => (
              <option key={i.id} value={i.id}>
                {i.description}
              </option>
            ))}
          </NativeSelect>
          <p className="text-muted-foreground text-xs">
            Vence junto com ele e o crédito é vinculado sozinho a cada mês.
          </p>
        </div>
      )}

      {!followsSalary && (
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
            <FieldError message={errors.dayValue?.message} />
          </div>
        </div>
      )}

      {!followsSalary && dayRule === 'DAY_OF_MONTH' && (
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
          {save.isPending ? 'Salvando…' : 'Salvar'}
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
            O que se repete todo mês: conta, recebimento, empréstimo ou algo
            fora da Pluggy.
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
