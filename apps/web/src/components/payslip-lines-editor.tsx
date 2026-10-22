import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  type PayslipLine,
  type PayslipLineKind,
  savePayslipLines,
} from '@/http/payslips'
import { parseReaisToCents } from '@/lib/money'
import { zodResolver } from '@/lib/zod-resolver'

const validAmount = (v: string) => parseReaisToCents(v) !== null

const schema = z.object({
  gross: z.string().refine((v) => v.trim() === '' || validAmount(v), {
    message: 'Informe um bruto válido',
  }),
  net: z.string().refine(validAmount, { message: 'Informe o líquido' }),
  lines: z.array(
    z.object({
      kind: z.enum(['EARNING', 'DEDUCTION']),
      description: z
        .string()
        .trim()
        .min(1, { message: 'Descrição obrigatória' }),
      reference: z.string(),
      amount: z.string().refine(validAmount, {
        message: 'Informe um valor válido',
      }),
    }),
  ),
})

type FormData = z.infer<typeof schema>

/** Centavos em "1234,56" — texto que `parseReaisToCents` lê de volta. */
function centsToInput(cents: number | null) {
  if (cents === null) return ''
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}

const KINDS: { kind: PayslipLineKind; singular: string; title: string }[] = [
  { kind: 'EARNING', singular: 'provento', title: 'Proventos' },
  { kind: 'DEDUCTION', singular: 'desconto', title: 'Descontos' },
]

export function PayslipLinesEditor({
  payslipId,
  grossCents,
  netCents,
  lines,
}: {
  payslipId: string
  grossCents: number | null
  netCents: number | null
  lines: PayslipLine[]
}) {
  const queryClient = useQueryClient()
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      gross: centsToInput(grossCents),
      net: centsToInput(netCents),
      lines: lines.map((l) => ({
        kind: l.kind,
        description: l.description,
        reference: l.reference ?? '',
        amount: centsToInput(l.amountCents),
      })),
    },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const watched = watch('lines')

  const save = useMutation({
    mutationFn: (input: Parameters<typeof savePayslipLines>[1]) =>
      savePayslipLines(payslipId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payslips'] }),
        queryClient.invalidateQueries({ queryKey: ['payslip', payslipId] }),
      ])
      toast.success('Valores salvos')
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível salvar. Tente novamente.',
        ),
      ),
  })

  function onSubmit(data: FormData) {
    const net = parseReaisToCents(data.net)
    if (net === null) return
    const gross = data.gross.trim() ? parseReaisToCents(data.gross) : null
    save.mutate({
      ...(gross !== null && { grossCents: gross }),
      netCents: net,
      lines: data.lines.map((l) => ({
        kind: l.kind,
        description: l.description.trim(),
        reference: l.reference.trim() || null,
        amountCents: parseReaisToCents(l.amount) ?? 0,
      })),
    })
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
      noValidate
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payslip-gross">Bruto (R$)</Label>
          <Input
            id="payslip-gross"
            inputMode="decimal"
            placeholder="0,00"
            {...register('gross')}
          />
          {errors.gross && (
            <p role="alert" className="text-destructive text-sm">
              {errors.gross.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payslip-net">Líquido (R$)</Label>
          <Input
            id="payslip-net"
            inputMode="decimal"
            placeholder="0,00"
            {...register('net')}
          />
          {errors.net && (
            <p role="alert" className="text-destructive text-sm">
              {errors.net.message}
            </p>
          )}
        </div>
      </div>

      {KINDS.map(({ kind, singular, title }) => {
        const rows = fields
          .map((field, index) => ({ field, index }))
          .filter(({ index }) => watched?.[index]?.kind === kind)
        return (
          <section key={kind} className="flex flex-col gap-3">
            <h3 className="text-base font-medium">{title}</h3>
            {rows.map(({ field, index }, n) => {
              const row = errors.lines?.[index]
              return (
                <div key={field.id} className="flex flex-col gap-1">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <Input
                      aria-label={`Descrição do ${singular} ${n + 1}`}
                      placeholder="Descrição"
                      {...register(`lines.${index}.description`)}
                    />
                    <Input
                      aria-label={`Referência do ${singular} ${n + 1}`}
                      placeholder="Referência"
                      className="sm:w-32"
                      {...register(`lines.${index}.reference`)}
                    />
                    <Input
                      aria-label={`Valor do ${singular} ${n + 1}`}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="sm:w-32"
                      {...register(`lines.${index}.amount`)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${singular} ${n + 1}`}
                      onClick={() => remove(index)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  {(row?.description || row?.amount) && (
                    <p role="alert" className="text-destructive text-sm">
                      {row.description?.message ?? row.amount?.message}
                    </p>
                  )}
                </div>
              )
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                append({ kind, description: '', reference: '', amount: '' })
              }
            >
              <Plus aria-hidden />
              {`Adicionar ${singular}`}
            </Button>
          </section>
        )
      })}

      <Button type="submit" className="self-start" disabled={save.isPending}>
        Salvar valores
      </Button>
    </form>
  )
}
