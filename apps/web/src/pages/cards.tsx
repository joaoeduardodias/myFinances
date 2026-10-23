import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { CardCycleForm } from '@/components/card-cycle-form'
import { CreditCardFace } from '@/components/credit-card-face'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { currentBill, listCards } from '@/http/cards'

export function Cards() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['cards'],
    queryFn: listCards,
  })

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Cartões</h1>

      {isPending && <Skeleton className="h-56 max-w-sm" aria-busy="true" />}
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
                <CardCycleForm accountId={c.id} />
              </CardContent>
            </Card>
          ))}
          {data.cards.length > 0 && (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.cards.map((c) => (
                <li key={c.account.id}>
                  <Link
                    to={`/cartoes/${c.account.id}`}
                    className="focus-visible:ring-ring block rounded-2xl transition-transform duration-200 outline-none hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    <CreditCardFace
                      account={c.account}
                      bill={currentBill(c.bills)}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
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
