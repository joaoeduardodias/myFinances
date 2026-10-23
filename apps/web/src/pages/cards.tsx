import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  type Bill,
  type BillStatus,
  type CardAccount,
  listCards,
  updateCardCycle,
} from '@/http/cards'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import { formatBRL, formatDate } from '@/lib/format'
import { zodResolver } from '@/lib/zod-resolver'

const STATUS_LABELS: Record<BillStatus, string> = {
  CLOSED: 'Fechada',
  OPEN: 'Aberta',
  FUTURE: 'Futura',
}

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

function CycleForm({
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

function BillView({ bill }: { bill: Bill }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Vencimento</dt>
          <dd>{formatDate(bill.dueDate)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total</dt>
          <dd>{formatBRL(bill.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pago</dt>
          <dd>{formatBRL(bill.paidCents)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Restante</dt>
          <dd>{formatBRL(bill.remainingCents)}</dd>
        </div>
      </dl>
      <div>
        <Badge variant="outline">{STATUS_LABELS[bill.status]}</Badge>
      </div>
      {bill.transactions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhuma compra nesta fatura.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {bill.transactions.map((t, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: a transação da fatura não tem id; o índice desempata compras iguais no mesmo dia.
              key={`${t.date}-${t.description}-${i}`}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{t.description}</span>
                <span className="text-muted-foreground text-xs">
                  {formatDate(t.date)}
                  {t.installmentNumber !== null &&
                    t.totalInstallments !== null && (
                      <>
                        {' · '}
                        <span>{`${t.installmentNumber}/${t.totalInstallments}`}</span>
                      </>
                    )}
                </span>
              </div>
              <span className={t.amountCents > 0 ? 'text-income' : undefined}>
                {formatBRL(t.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CreditCard({
  account,
  bills,
}: {
  account: CardAccount
  bills: Bill[]
}) {
  const [editing, setEditing] = useState(false)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{account.name}</CardTitle>
          <CardDescription>
            {`Fecha dia ${account.closingDay ?? '-'} · vence dia ${account.dueDay ?? '-'}`}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Ajustar fechamento/vencimento de ${account.name}`}
          onClick={() => setEditing(true)}
        >
          <Settings2 aria-hidden />
          Ajustar fechamento/vencimento
        </Button>
      </CardHeader>
      <CardContent>
        {bills.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma fatura.</p>
        ) : (
          <Tabs
            defaultValue={`${(bills.find((b) => b.status === 'OPEN') ?? bills[0]).closeDate}`}
          >
            <TabsList className="h-auto flex-wrap">
              {bills.map((b) => (
                <TabsTrigger key={b.closeDate} value={b.closeDate}>
                  {`${STATUS_LABELS[b.status]} · ${formatDate(b.dueDate).slice(0, 5)}`}
                </TabsTrigger>
              ))}
            </TabsList>
            {bills.map((b) => (
              <TabsContent
                key={b.closeDate}
                value={b.closeDate}
                className="pt-3"
              >
                <BillView bill={b} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Ajustar ${account.name}`}</DialogTitle>
            <DialogDescription>
              Dias do mês em que a fatura fecha e vence.
            </DialogDescription>
          </DialogHeader>
          <CycleForm
            accountId={account.id}
            initial={account}
            onSaved={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function Cards() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['cards'],
    queryFn: listCards,
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Cartões</h1>

      {isPending && <Skeleton className="h-40" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar os cartões.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && (
        <>
          {data.cardsMissingCycle.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <CardDescription>
                  Informe os dias de fechamento e vencimento para ver as
                  faturas.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CycleForm accountId={c.id} />
              </CardContent>
            </Card>
          ))}
          {data.cards.map((c) => (
            <CreditCard
              key={c.account.id}
              account={c.account}
              bills={c.bills}
            />
          ))}
          {data.cards.length === 0 && data.cardsMissingCycle.length === 0 && (
            <p className="text-muted-foreground text-sm">
              Nenhum cartão de crédito encontrado.
            </p>
          )}
        </>
      )}
    </div>
  )
}
