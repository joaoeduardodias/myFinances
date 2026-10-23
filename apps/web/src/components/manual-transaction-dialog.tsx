import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
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
  type ManualTransactionInput,
} from '@/http/transactions'
import { parseReaisToCents } from '@/lib/money'
import { todayInSaoPaulo } from '@/lib/period'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object({
  date: z.string().min(1, { message: 'Informe a data' }),
  description: z.string().trim().min(1, { message: 'Descrição obrigatória' }),
  amount: z.string().refine((v) => parseReaisToCents(v) !== null, {
    message: 'Informe um valor válido',
  }),
  income: z.boolean(),
})

type FormData = z.infer<typeof schema>

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
    defaultValues: {
      date: todayInSaoPaulo(),
      description: '',
      amount: '',
      income: false,
    },
  })
  const income = watch('income')

  const create = useMutation({
    mutationFn: (input: ManualTransactionInput) =>
      createManualTransaction(input),
    onSuccess: async () => {
      await Promise.all(
        ['transactions', 'dashboard', 'accounts'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      reset({
        date: todayInSaoPaulo(),
        description: '',
        amount: '',
        income: false,
      })
      setOpen(false)
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
      amountCents: data.income ? cents : -cents,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Lançar manualmente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançar manualmente</DialogTitle>
          <DialogDescription>
            Registre uma entrada ou saída que não veio do banco.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex items-center gap-3">
            <input
              id="manual-income"
              type="checkbox"
              // biome-ignore lint/a11y/useAriaPropsForRole: o checkbox nativo já expõe o estado marcado.
              role="switch"
              className="accent-primary size-5"
              {...register('income')}
            />
            <Label htmlFor="manual-income">Entrada</Label>
            <span className="text-muted-foreground text-sm">
              {income ? 'Dinheiro que entrou' : 'Dinheiro que saiu'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-date">Data</Label>
            <Input id="manual-date" type="date" {...register('date')} />
            {errors.date && (
              <p role="alert" className="text-destructive text-sm">
                {errors.date.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-description">Descrição</Label>
            <Input id="manual-description" {...register('description')} />
            {errors.description && (
              <p role="alert" className="text-destructive text-sm">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manual-amount">Valor (R$)</Label>
            <Input
              id="manual-amount"
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

          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Lançar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
