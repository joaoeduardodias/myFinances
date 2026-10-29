import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { BanksOverview, CardsOverview } from '@/components/accounts-overview'
import { AdvisorCard } from '@/components/advisor-card'
import { FlowChart, FlowSummary } from '@/components/monthly-flow'
import { PayablesOverview } from '@/components/payables-overview'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { type Dashboard, getDashboard, syncAll } from '@/http/dashboard'
import { formatBRL, formatDate } from '@/lib/format'

const monthLabel = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
})

const linkClass = 'font-medium underline underline-offset-4'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="bg-muted text-muted-foreground flex items-start gap-3 rounded-lg border p-4 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{children}</p>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6"
      aria-busy="true"
    >
      <div className="flex flex-col gap-4 xl:order-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-40" />
      </div>
      <div className="flex flex-col gap-4 xl:order-1 xl:gap-6">
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-[30rem]" />
      </div>
    </div>
  )
}

function DashboardContent({ data }: { data: Dashboard }) {
  const { nextIncome, windowEnd } = data
  const perDayTarget = nextIncome
    ? `${nextIncome.description} (${formatDate(nextIncome.date)})`
    : `o fim do mês (${formatDate(windowEnd)})`

  // No celular, contas e cartões vêm primeiro; na tela larga, ficam na coluna da direita.
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-6">
      <aside className="flex flex-col gap-4 xl:order-2">
        <BanksOverview banks={data.banks} />
        <CardsOverview cards={data.cards} />
        <PayablesOverview
          payables={data.payables}
          totalCents={data.payableTotalCents}
          today={data.today}
          windowEnd={windowEnd}
        />

        <Card>
          <CardHeader>
            <CardDescription>Quanto posso gastar</CardDescription>
            <CardTitle
              className={`text-4xl font-semibold tabular-nums ${
                data.availableCents < 0 ? 'text-destructive' : ''
              }`}
            >
              {formatBRL(data.availableCents)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground tabular-nums">
              {`${formatBRL(data.perDayCents)}/dia até ${perDayTarget}`}
            </p>
          </CardContent>
        </Card>
      </aside>

      <div className="flex min-w-0 flex-col gap-4 xl:order-1 xl:gap-6">
        <AdvisorCard today={data.today} />
        <FlowSummary flow={data.flow} />
        <FlowChart flow={data.flow} />
      </div>
    </div>
  )
}

export function Home() {
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  })

  const sync = useMutation({
    mutationFn: (force: boolean) => syncAll(force),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    // O resumo do consultor pode ter mudado com o que o sync trouxe.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
    onError: () =>
      toast.error('Não foi possível sincronizar agora. Tente novamente.'),
  })

  // Uma sincronização por montagem (o guard evita a duplicada do StrictMode).
  const started = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda uma vez; `sync` muda a cada render.
  useEffect(() => {
    if (started.current) return
    started.current = true
    sync.mutate(false)
  }, [])

  return (
    <div className="flex w-full flex-col gap-4 p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Início</h1>
          {data && (
            <p className="text-muted-foreground text-sm">
              {`Visão geral · ${monthLabel.format(new Date(`${data.today}T12:00:00`))}`}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={sync.isPending}
          onClick={() => sync.mutate(true)}
        >
          <RefreshCw
            className={sync.isPending ? 'animate-spin' : ''}
            aria-hidden
          />
          Sincronizar
        </Button>
      </div>

      {data?.noIncomeConfigured && (
        <Notice>
          Confirme seu salário em{' '}
          <Link to="/recorrentes" className={linkClass}>
            Recorrentes
          </Link>{' '}
          para a projeção ir até o próximo recebimento.
        </Notice>
      )}
      {data && data.cardsMissingCycle.length > 0 && (
        <Notice>
          Configure o ciclo de fatura em{' '}
          <Link to="/cartoes" className={linkClass}>
            Cartões
          </Link>
          : {data.cardsMissingCycle.map((c) => c.name).join(', ')}.
        </Notice>
      )}

      {isPending && <DashboardSkeleton />}
      {isError && (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">Não foi possível carregar seus dados.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && <DashboardContent data={data} />}
    </div>
  )
}
