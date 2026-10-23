import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { CardCycleForm } from '@/components/card-cycle-form'
import { CreditCardFace } from '@/components/credit-card-face'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BILL_STATUS_LABELS,
  type Bill,
  currentBill,
  listCards,
} from '@/http/cards'
import { formatBRL, formatDate } from '@/lib/format'

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
        <Badge variant="outline">{BILL_STATUS_LABELS[bill.status]}</Badge>
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

export function CardDetail() {
  const { id = '' } = useParams()
  const [editing, setEditing] = useState(false)
  // Mesma consulta da lista: vindo de lá, o cartão já está no cache.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['cards'],
    queryFn: listCards,
  })

  const card = data?.cards.find((c) => c.account.id === id)
  const current = card && currentBill(card.bills)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <Link
        to="/cartoes"
        className="text-muted-foreground flex items-center gap-1 self-start text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Cartões
      </Link>

      {isPending && <Skeleton className="h-56" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar o cartão.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && !card && (
        <p className="text-muted-foreground text-sm">Cartão não encontrado.</p>
      )}
      {card && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">{card.account.name}</h1>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Ajustar fechamento/vencimento de ${card.account.name}`}
              onClick={() => setEditing(true)}
            >
              <Settings2 aria-hidden />
              Ajustar fechamento/vencimento
            </Button>
          </div>

          <div className="w-full max-w-sm">
            <CreditCardFace account={card.account} bill={current} />
          </div>

          <h2 className="text-base font-medium">Lançamentos</h2>
          {current ? (
            <Tabs defaultValue={current.closeDate}>
              <TabsList className="h-auto flex-wrap">
                {card.bills.map((b) => (
                  <TabsTrigger key={b.closeDate} value={b.closeDate}>
                    {`${BILL_STATUS_LABELS[b.status]} · ${formatDate(b.dueDate).slice(0, 5)}`}
                  </TabsTrigger>
                ))}
              </TabsList>
              {card.bills.map((b) => (
                <TabsContent
                  key={b.closeDate}
                  value={b.closeDate}
                  className="pt-3"
                >
                  <BillView bill={b} />
                </TabsContent>
              ))}
            </Tabs>
          ) : (
            <p className="text-muted-foreground text-sm">Nenhuma fatura.</p>
          )}

          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{`Ajustar ${card.account.name}`}</DialogTitle>
                <DialogDescription>
                  Dias do mês em que a fatura fecha e vence.
                </DialogDescription>
              </DialogHeader>
              <CardCycleForm
                accountId={card.account.id}
                initial={card.account}
                onSaved={() => setEditing(false)}
              />
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
