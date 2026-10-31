import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  Landmark,
  type LucideIcon,
  Plus,
  Receipt,
  ShoppingBasket,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { RecurrenceFormDialog } from '@/components/recurrence-form'
import {
  Amount,
  RecurrenceRow,
  ruleText,
  StatusChip,
  sourceText,
} from '@/components/recurrence-row'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  dismissRecurrence,
  listRecurrences,
  type Recurrence,
  updateRecurrence,
} from '@/http/recurrences'
import { formatBRL } from '@/lib/format'

type Tab = 'ACTIVE' | 'PAID_OFF' | 'DISMISSED'

type Group = {
  id: string
  title: string
  icon: LucideIcon
  matches: (r: Recurrence) => boolean
}

const GROUPS: Group[] = [
  {
    id: 'bills',
    title: 'Contas do mês',
    icon: Receipt,
    matches: (r) => r.kind === 'MONTHLY' && r.direction === 'OUT',
  },
  {
    id: 'incomes',
    title: 'Recebimentos',
    icon: ArrowDownLeft,
    matches: (r) => r.kind === 'MONTHLY' && r.direction === 'IN',
  },
  {
    id: 'loans',
    title: 'Empréstimos',
    icon: Landmark,
    matches: (r) => r.kind === 'LOAN',
  },
  {
    id: 'external',
    title: 'Fora da Pluggy',
    icon: ShoppingBasket,
    matches: (r) => r.kind === 'EXTERNAL',
  },
]

const MONTH_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
})

function isActive(r: Recurrence) {
  return r.status === 'CONFIRMED' && !r.paidOff
}

function tabOf(r: Recurrence): Tab | null {
  if (r.status === 'DISMISSED') return 'DISMISSED'
  if (r.paidOff) return 'PAID_OFF'
  return r.status === 'CONFIRMED' ? 'ACTIVE' : null
}

/** Próximo vencimento primeiro; sem status do mês (fora da Pluggy), pelo dia. */
function byNextDate(a: Recurrence, b: Recurrence) {
  const key = (r: Recurrence) =>
    r.monthStatus?.date.slice(8, 10) ?? String(r.dayValue).padStart(2, '0')
  return (
    key(a).localeCompare(key(b)) || a.description.localeCompare(b.description)
  )
}

function sum(list: Recurrence[]) {
  return list.reduce((total, r) => total + r.expectedAmountCents, 0)
}

function Kpi({
  label,
  value,
  hint,
  children,
}: {
  label: string
  value: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <Card className="gap-0 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-lg font-semibold tabular-nums">{value}</span>
      </div>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      {children}
    </Card>
  )
}

function Summary({ recurrences }: { recurrences: Recurrence[] }) {
  const active = recurrences.filter(isActive)
  const out = active.filter(
    // Em folha já veio abatido do salário que entra: contar aqui dobraria.
    (r) =>
      r.direction === 'OUT' && r.kind !== 'EXTERNAL' && !r.payrollDeduction,
  )
  const incoming = active.filter((r) => r.direction === 'IN')
  const external = incoming.filter((r) => r.kind === 'EXTERNAL')
  const tracked = active.filter((r) => r.monthStatus !== null)
  const paid = tracked.filter((r) => r.monthStatus?.state === 'PAID').length
  const loansLeft = active.reduce(
    (total, r) => total + (r.loan?.remainingCents ?? 0),
    0,
  )
  const percent = tracked.length ? Math.round((paid / tracked.length) * 100) : 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        label="Sai por mês"
        value={formatBRL(sum(out))}
        hint="contas e empréstimos"
      />
      <Kpi
        label="Entra por mês"
        value={formatBRL(sum(incoming))}
        hint={
          external.length
            ? `${formatBRL(sum(external))} fora da Pluggy`
            : 'recebimentos'
        }
      />
      <Kpi label="Pago este mês" value={`${paid} de ${tracked.length}`}>
        <span
          className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full"
          aria-hidden
        >
          <span
            className="bg-income block h-full"
            style={{ width: `${percent}%` }}
          />
        </span>
      </Kpi>
      <Kpi
        label="Empréstimos"
        value={formatBRL(loansLeft)}
        hint="ainda a pagar"
      />
    </div>
  )
}

function useInvalidatingMutation(
  fn: (id: string) => Promise<unknown>,
  failure: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    // Arrow: o TanStack passa um 2º argumento (contexto) que não é da API.
    mutationFn: (id: string) => fn(id),
    onSuccess: () =>
      Promise.all(
        ['recurrences', 'recurrence', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    onError: async (error) =>
      toast.error(await getApiErrorMessage(error, failure)),
  })
}

function Suggestions({
  suggestions,
  onConfirm,
}: {
  suggestions: Recurrence[]
  onConfirm: (r: Recurrence) => void
}) {
  const dismiss = useInvalidatingMutation(
    (id) => dismissRecurrence(id),
    'Não foi possível descartar. Tente novamente.',
  )
  if (suggestions.length === 0) return null
  return (
    <section
      aria-labelledby="suggestions-title"
      className="flex flex-col gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3"
    >
      <h2 id="suggestions-title" className="text-sm font-medium">
        {`${suggestions.length === 1 ? '1 sugestão' : `${suggestions.length} sugestões`}: achamos isto se repetindo. Confirme ou descarte.`}
      </h2>
      <ul className="flex flex-col divide-y divide-sky-500/20">
        {suggestions.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate font-medium">
                {r.description}
              </span>
              <span className="text-muted-foreground block text-xs">
                {`${ruleText(r)} · ${sourceText(r)}`}
              </span>
            </span>
            <Amount recurrence={r} />
            <Button
              size="sm"
              aria-label={`Confirmar ${r.description}`}
              onClick={() => onConfirm(r)}
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
          </li>
        ))}
      </ul>
    </section>
  )
}

function GroupSection({
  group,
  items,
  onEdit,
}: {
  group: Group
  items: Recurrence[]
  onEdit: (r: Recurrence) => void
}) {
  const titleId = `group-${group.id}`
  const tracked = items.filter((r) => r.monthStatus)
  const paid = tracked.filter((r) => r.monthStatus?.state === 'PAID').length
  const detail =
    group.id === 'external'
      ? 'lançados à mão'
      : tracked.length
        ? `${paid} de ${tracked.length} ${group.id === 'incomes' ? 'recebidos' : 'pagos'}`
        : ''
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2
        id={titleId}
        className="flex items-baseline justify-between gap-3 text-sm font-medium"
      >
        <span>{group.title}</span>
        <span className="text-muted-foreground text-xs font-normal">
          {[`${formatBRL(sum(items))}/mês`, detail].filter(Boolean).join(' · ')}
        </span>
      </h2>
      <Card className="gap-0 overflow-hidden py-0">
        <ul className="divide-y">
          {items.map((r) => (
            <RecurrenceRow
              key={r.id}
              recurrence={r}
              icon={group.icon}
              onEdit={onEdit}
            />
          ))}
        </ul>
      </Card>
    </section>
  )
}

function ArchivedList({
  items,
  tab,
}: {
  items: Recurrence[]
  tab: Exclude<Tab, 'ACTIVE'>
}) {
  const reactivate = useInvalidatingMutation(
    (id) => updateRecurrence(id, { status: 'CONFIRMED' }),
    tab === 'DISMISSED'
      ? 'Não foi possível reativar. Tente novamente.'
      : 'Não foi possível reabrir. Tente novamente.',
  )
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {tab === 'DISMISSED'
          ? 'Nenhum recorrente descartado.'
          : 'Nenhum empréstimo quitado.'}
      </p>
    )
  }
  const action = tab === 'DISMISSED' ? 'Reativar' : 'Reabrir'
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <ul className="divide-y">
        {items.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-3 px-4 py-3"
          >
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate font-medium">
                {r.description}
              </span>
              <span className="text-muted-foreground block text-xs">
                {`${ruleText(r)} · ${sourceText(r)}`}
              </span>
            </span>
            <StatusChip recurrence={r} />
            <Amount recurrence={r} />
            {/* Quitado pela contagem reabre editando as parcelas, não pelo status. */}
            {(tab === 'DISMISSED' || r.status === 'PAID_OFF') && (
              <Button
                variant="outline"
                size="sm"
                aria-label={`${action} ${r.description}`}
                disabled={reactivate.isPending}
                onClick={() => reactivate.mutate(r.id)}
              >
                {action}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function Recurring() {
  const [formOpen, setFormOpen] = useState(false)
  const [toEdit, setToEdit] = useState<Recurrence | null>(null)
  const [tab, setTab] = useState<Tab>('ACTIVE')
  const [search, setSearch] = useState('')

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['recurrences'],
    queryFn: listRecurrences,
  })

  const query = search.trim().toLocaleLowerCase('pt-BR')
  const inTab = (t: Tab) =>
    (data ?? []).filter(
      (r) =>
        tabOf(r) === t &&
        (!query || r.description.toLocaleLowerCase('pt-BR').includes(query)),
    )
  const counts = {
    ACTIVE: data?.filter((r) => tabOf(r) === 'ACTIVE').length ?? 0,
    PAID_OFF: data?.filter((r) => tabOf(r) === 'PAID_OFF').length ?? 0,
    DISMISSED: data?.filter((r) => tabOf(r) === 'DISMISSED').length ?? 0,
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'ACTIVE', label: 'Ativos' },
    { id: 'PAID_OFF', label: 'Quitados' },
    { id: 'DISMISSED', label: 'Descartados' },
  ]
  const active = inTab('ACTIVE').sort(byNextDate)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Recorrentes</h1>
          <p className="text-muted-foreground text-sm first-letter:uppercase">
            {MONTH_FORMAT.format(new Date())}
          </p>
        </div>
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
          <Summary recurrences={data} />
          <Suggestions
            suggestions={data.filter((r) => r.status === 'SUGGESTED')}
            onConfirm={setToEdit}
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-muted/50 flex gap-1 rounded-lg p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${tab === t.id ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground'}`}
                >
                  {t.id === 'ACTIVE' ? t.label : `${t.label} (${counts[t.id]})`}
                </button>
              ))}
            </div>
            <Input
              aria-label="Buscar recorrente"
              placeholder="Buscar"
              className="sm:ml-auto sm:w-56"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          {tab === 'ACTIVE' &&
            (active.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {query
                  ? 'Nenhum recorrente encontrado.'
                  : 'Nenhum recorrente ativo.'}
              </p>
            ) : (
              GROUPS.map((group) => {
                const items = active.filter(group.matches)
                return items.length === 0 ? null : (
                  <GroupSection
                    key={group.id}
                    group={group}
                    items={items}
                    onEdit={setToEdit}
                  />
                )
              })
            ))}
          {tab !== 'ACTIVE' && <ArchivedList items={inTab(tab)} tab={tab} />}
        </>
      )}

      <RecurrenceFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <RecurrenceFormDialog
        key={toEdit?.id}
        open={toEdit !== null}
        onOpenChange={(open) => !open && setToEdit(null)}
        recurrence={toEdit ?? undefined}
      />
    </div>
  )
}
