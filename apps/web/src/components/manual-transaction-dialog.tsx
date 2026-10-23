import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Loader2Icon, Plus } from 'lucide-react'
import { useState } from 'react'
import { type FieldError, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { NativeSelect } from '@/components/native-select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  createManualTransaction,
  listCategories,
  type ManualTransactionInput,
} from '@/http/transactions'
import { parseReaisToCents } from '@/lib/money'
import { todayInSaoPaulo } from '@/lib/period'
import { cn } from '@/lib/utils'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object({
  kind: z.enum(['expense', 'income']),
  date: z.string().min(1, { message: 'Informe a data' }),
  description: z.string().trim().min(1, { message: 'Descrição obrigatória' }),
  amount: z.string().refine((v) => parseReaisToCents(v) !== null, {
    message: 'Informe um valor válido',
  }),
  category: z.string(),
})

type FormData = z.infer<typeof schema>

function emptyForm(): FormData {
  return {
    kind: 'expense',
    date: todayInSaoPaulo(),
    description: '',
    amount: '',
    category: '',
  }
}

const kinds = [
  {
    value: 'expense',
    label: 'Saída',
    icon: ArrowUpRight,
    checked:
      'has-[:checked]:border-destructive/40 has-[:checked]:text-destructive',
  },
  {
    value: 'income',
    label: 'Entrada',
    icon: ArrowDownLeft,
    checked: 'has-[:checked]:border-income/40 has-[:checked]:text-income',
  },
] as const

function FieldMessage({ id, error }: { id: string; error?: FieldError }) {
  if (!error) return null
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {error.message}
    </p>
  )
}

export function ManualTransactionDialog() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: emptyForm(),
  })
  const isIncome = watch('kind') === 'income'
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    enabled: open,
  })

  function changeOpen(next: boolean) {
    // Reabrir começa do zero, com a data de hoje.
    if (!next) reset(emptyForm())
    setOpen(next)
  }

  const create = useMutation({
    mutationFn: (input: ManualTransactionInput) =>
      createManualTransaction(input),
    onSuccess: async () => {
      await Promise.all(
        ['transactions', 'dashboard', 'accounts'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      toast.success('Lançamento registrado na Carteira.')
      changeOpen(false)
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível lançar. Tente novamente.',
        ),
      ),
  })

  function onSubmit(data: FormData) {
    const cents = parseReaisToCents(data.amount)
    if (cents === null) return
    create.mutate({
      date: data.date,
      description: data.description.trim(),
      amountCents: data.kind === 'income' ? cents : -cents,
      category: data.category || undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Lançar manualmente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lançar manualmente</DialogTitle>
          <DialogDescription>
            Registre na Carteira uma entrada ou saída que não veio do banco.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-5"
          noValidate
        >
          <fieldset className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1">
            <legend className="sr-only">Tipo</legend>
            {kinds.map(({ value, label, icon: Icon, checked }) => (
              <label
                key={value}
                className={cn(
                  'text-muted-foreground hover:text-foreground flex h-9 border border-transparent cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors duration-200',
                  'has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-[3px]',
                  // Fundo sólido: o tom /15 deixava o texto abaixo de 4,5:1 no tema claro.
                  'has-[:checked]:bg-background has-[:checked]:shadow-xs',
                  checked,
                )}
              >
                <input
                  type="radio"
                  value={value}
                  className="sr-only"
                  {...register('kind')}
                />
                <Icon aria-hidden className="size-4" />
                {label}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-amount">Valor (R$)</Label>
            <div className="relative">
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-lg font-medium',
                  isIncome ? 'text-income' : 'text-destructive',
                )}
              >
                {isIncome ? '+' : '−'} R$
              </span>
              <Input
                id="manual-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,00"
                autoFocus
                className="h-12 pl-16 text-lg font-semibold tabular-nums md:text-lg"
                aria-invalid={!!errors.amount}
                aria-describedby={
                  errors.amount ? 'manual-amount-error' : undefined
                }
                {...register('amount')}
              />
            </div>
            <FieldMessage id="manual-amount-error" error={errors.amount} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-description">Descrição</Label>
            <Input
              id="manual-description"
              placeholder={
                isIncome ? 'Ex.: venda, reembolso' : 'Ex.: feira, café'
              }
              aria-invalid={!!errors.description}
              aria-describedby={
                errors.description ? 'manual-description-error' : undefined
              }
              {...register('description')}
            />
            <FieldMessage
              id="manual-description-error"
              error={errors.description}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-date">Data</Label>
              <Input
                id="manual-date"
                type="date"
                aria-invalid={!!errors.date}
                aria-describedby={errors.date ? 'manual-date-error' : undefined}
                {...register('date')}
              />
              <FieldMessage id="manual-date-error" error={errors.date} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-category">Categoria</Label>
              <NativeSelect id="manual-category" {...register('category')}>
                <option value="">Sem categoria</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && (
                <Loader2Icon aria-hidden className="animate-spin" />
              )}
              {isIncome ? 'Lançar entrada' : 'Lançar saída'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
