import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  type AdvisorGoal,
  endAdvisorGoal,
  type GoalMonth,
  type GoalTarget,
} from '@/http/advisor'
import { formatBRL } from '@/lib/format'
import { cn } from '@/lib/utils'

export function goalLabel(target: GoalTarget): string {
  return target.kind === 'CATEGORY'
    ? `${target.category} até ${formatBRL(target.targetCents)} por mês`
    : `Guardar ${target.targetPercent}% da renda`
}

export function sameGoal(a: GoalTarget, b: GoalTarget): boolean {
  if (a.kind === 'CATEGORY' && b.kind === 'CATEGORY') {
    return a.category === b.category && a.targetCents === b.targetCents
  }
  return (
    a.kind === 'SAVINGS' &&
    b.kind === 'SAVINGS' &&
    a.targetPercent === b.targetPercent
  )
}

const monthFormat = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** "2026-10" em "outubro de 2026" (pedido do João). */
function monthName(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return monthFormat.format(new Date(Date.UTC(year, m - 1, 1)))
}

function valueText(target: GoalTarget, value: number): string {
  return target.kind === 'CATEGORY' ? formatBRL(value) : `${value}%`
}

function currentText(target: GoalTarget, current: GoalMonth): string {
  return target.kind === 'CATEGORY'
    ? `${formatBRL(current.value)} de ${formatBRL(target.targetCents)} neste mês`
    : `${current.value}% guardado neste mês, até agora`
}

/** Fração da barra: no teto, quanto do teto foi usado; na sobra, quanto da meta foi atingido. */
function fill(target: GoalTarget, value: number): number {
  const goal =
    target.kind === 'CATEGORY' ? target.targetCents : target.targetPercent
  return goal > 0 ? Math.min(Math.max(value / goal, 0), 1) : 0
}

function GoalRow({ goal }: { goal: AdvisorGoal }) {
  const queryClient = useQueryClient()
  const end = useMutation({
    mutationFn: () => endAdvisorGoal(goal.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })
  const label = goalLabel(goal.target)
  const current = goal.months.find((m) => m.partial)
  const closed = goal.months.filter((m) => !m.partial)
  // No teto, passar do limite é o alerta; na sobra, ficar abaixo é o normal até o mês fechar.
  const over =
    current !== undefined && goal.target.kind === 'CATEGORY' && !current.met

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{label}</p>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground -mt-1 -mr-2 size-7"
          aria-label={`Encerrar meta ${label}`}
          title="Encerrar meta"
          disabled={end.isPending}
          onClick={() => end.mutate()}
        >
          <X />
        </Button>
      </div>
      {current && (
        <>
          <div
            role="progressbar"
            aria-label={`Andamento da meta ${label}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fill(goal.target, current.value) * 100)}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                over ? 'bg-destructive/80' : 'bg-primary',
              )}
              style={{ width: `${fill(goal.target, current.value) * 100}%` }}
            />
          </div>
          <p
            className={cn(
              'text-sm tabular-nums',
              over ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {currentText(goal.target, current)}
          </p>
        </>
      )}
      {closed.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5">
          {closed.map((m) => {
            const status = m.met ? 'cumpriu' : 'estourou'
            const text = `${monthName(m.month)}: ${status} (${valueText(goal.target, m.value)})`
            return (
              <li
                key={m.month}
                aria-label={text}
                title={text}
                className={cn(
                  'size-2.5 rounded-full',
                  m.met ? 'bg-primary' : 'bg-destructive/80',
                )}
              />
            )
          })}
          <li className="text-muted-foreground ml-1 text-xs">
            {`${closed.filter((m) => m.met).length} de ${closed.length} ${closed.length === 1 ? 'mês cumprido' : 'meses cumpridos'}`}
          </li>
        </ul>
      )}
    </li>
  )
}

export function AdvisorGoals({ goals }: { goals: AdvisorGoal[] }) {
  if (goals.length === 0) return null
  return (
    <section aria-labelledby="advisor-goals" className="flex flex-col gap-3">
      <h3 id="advisor-goals" className="text-sm font-medium">
        Metas
      </h3>
      <ul className="flex flex-col gap-4">
        {goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} />
        ))}
      </ul>
    </section>
  )
}
