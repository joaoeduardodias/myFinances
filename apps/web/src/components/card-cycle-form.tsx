import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateCardCycle } from '@/http/cards'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import { zodResolver } from '@/lib/zod-resolver'

const day = (message: string) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 31, {
      message,
    })

const schema = z.object({
  closingDay: day('Fechamento: informe um dia de 1 a 31'),
  dueDay: day('Vencimento: informe um dia de 1 a 31'),
})

type FormData = z.infer<typeof schema>

export function CardCycleForm({
  accountId,
  initial,
  onSaved,
}: {
  accountId: string
  initial?: { closingDay: number | null; dueDay: number | null }
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      closingDay: initial?.closingDay?.toString() ?? '',
      dueDay: initial?.dueDay?.toString() ?? '',
    },
  })

  const save = useMutation({
    mutationFn: (data: FormData) =>
      updateCardCycle(accountId, {
        closingDay: Number(data.closingDay),
        dueDay: Number(data.dueDay),
      }),
    onSuccess: async () => {
      await Promise.all(
        ['cards', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      onSaved?.()
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível salvar o ciclo. Tente novamente.',
        ),
      ),
  })

  const closingId = `closing-${accountId}`
  const dueId = `due-${accountId}`

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((data) => save.mutate(data))}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={closingId}>Dia de fechamento</Label>
          <Input
            id={closingId}
            inputMode="numeric"
            aria-invalid={errors.closingDay ? true : undefined}
            {...register('closingDay')}
          />
          {errors.closingDay && (
            <p role="alert" className="text-destructive text-sm">
              {errors.closingDay.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={dueId}>Dia de vencimento</Label>
          <Input
            id={dueId}
            inputMode="numeric"
            aria-invalid={errors.dueDay ? true : undefined}
            {...register('dueDay')}
          />
          {errors.dueDay && (
            <p role="alert" className="text-destructive text-sm">
              {errors.dueDay.message}
            </p>
          )}
        </div>
      </div>
      <Button type="submit" className="self-end" disabled={save.isPending}>
        Salvar
      </Button>
    </form>
  )
}
