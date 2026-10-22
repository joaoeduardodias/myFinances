import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { RecurrenceFormDialog } from '@/components/recurrence-form'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  dismissRecurrence,
  listRecurrences,
  type Recurrence,
} from '@/http/recurrences'
import { formatBRL } from '@/lib/format'

function ruleText(r: Recurrence) {
  return r.dayRule === 'DAY_OF_MONTH'
    ? `Todo dia ${r.dayValue}`
    : `${r.dayValue}º dia útil`
}

function RecurrenceRow({
  recurrence,
  actions,
}: {
  recurrence: Recurrence
  actions?: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-medium">{recurrence.description}</span>
        <span className="text-muted-foreground">
          {`${recurrence.account.name} · ${ruleText(recurrence)}`}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={`text-sm ${recurrence.direction === 'IN' ? 'text-income' : ''}`}
        >
          {`${recurrence.direction === 'IN' ? '+' : '-'}${formatBRL(recurrence.expectedAmountCents)}`}
        </span>
        {actions}
      </div>
    </li>
  )
}

function Section({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode[]
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{title}</h2>
      {children.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">{children}</ul>
      )}
    </section>
  )
}

export function Recurring() {
  const queryClient = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [toConfirm, setToConfirm] = useState<Recurrence | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['recurrences'],
    queryFn: listRecurrences,
  })

  const dismiss = useMutation({
    mutationFn: (id: string) => dismissRecurrence(id),
    onSuccess: () =>
      Promise.all(
        ['recurrences', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível descartar. Tente novamente.',
        ),
      ),
  })

  const byStatus = (status: Recurrence['status']) =>
    data?.filter((r) => r.status === status) ?? []
  const dismissed = byStatus('DISMISSED')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Recorrentes</h1>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus aria-hidden />
          Novo recorrente
        </Button>
      </div>

      {isPending && <Skeleton className="h-32" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar os recorrentes.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && (
        <>
          <Section title="Sugeridos" empty="Nenhuma sugestão no momento.">
            {byStatus('SUGGESTED').map((r) => (
              <RecurrenceRow
                key={r.id}
                recurrence={r}
                actions={
                  <>
                    <Button
                      size="sm"
                      aria-label={`Confirmar ${r.description}`}
                      onClick={() => setToConfirm(r)}
                    >
                      Confirmar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Descartar ${r.description}`}
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate(r.id)}
                    >
                      Descartar
                    </Button>
                  </>
                }
              />
            ))}
          </Section>

          <Section title="Confirmados" empty="Nenhum recorrente confirmado.">
            {byStatus('CONFIRMED').map((r) => (
              <RecurrenceRow key={r.id} recurrence={r} />
            ))}
          </Section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">
              <button
                type="button"
                className="flex items-center gap-1"
                aria-expanded={showDismissed}
                aria-controls="recurrences-dismissed"
                onClick={() => setShowDismissed((v) => !v)}
              >
                {showDismissed ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
                {`Descartados (${dismissed.length})`}
              </button>
            </h2>
            {showDismissed && (
              <ul
                id="recurrences-dismissed"
                className="divide-y rounded-lg border"
              >
                {dismissed.map((r) => (
                  <RecurrenceRow key={r.id} recurrence={r} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <RecurrenceFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <RecurrenceFormDialog
        key={toConfirm?.id}
        open={toConfirm !== null}
        onOpenChange={(open) => !open && setToConfirm(null)}
        recurrence={toConfirm ?? undefined}
      />
    </div>
  )
}
