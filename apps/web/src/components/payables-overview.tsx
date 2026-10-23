import { CalendarClock, CreditCard, Repeat } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Card } from '@/components/ui/card'
import type { Payable } from '@/http/dashboard'
import { formatBRL, formatDate } from '@/lib/format'
import type { IsoDate } from '@/lib/types'

import { rowLink, sectionLabel } from './accounts-overview'

const DAY_MS = 86_400_000

function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  )
}

function dueLabel(dueDate: IsoDate, today: IsoDate): string {
  const days = daysBetween(dueDate, today)
  if (days === 0) return 'Vence hoje'
  if (days === 1) return 'Venceu ontem'
  if (days > 1) return `Venceu há ${days} dias`
  return `Vence em ${formatDate(dueDate)}`
}

/** Fatura vai para o cartão (o `refId` é `accountId:vencimento`); recorrente, para Recorrentes. */
function payableHref(payable: Payable): string {
  return payable.kind === 'BILL'
    ? `/cartoes/${payable.refId.split(':')[0]}`
    : '/recorrentes'
}

function PayableRow({ payable, today }: { payable: Payable; today: IsoDate }) {
  const overdue = payable.dueDate < today
  const Icon = payable.kind === 'BILL' ? CreditCard : Repeat
  return (
    <li>
      <Link
        to={payableHref(payable)}
        className={`${rowLink} items-center px-6 py-3`}
      >
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
          <Icon className="text-muted-foreground size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {payable.description}
          </span>
          <span
            className={`block text-xs ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
          >
            {dueLabel(payable.dueDate, today)}
          </span>
        </span>
        <span className="text-destructive font-semibold tabular-nums">
          {formatBRL(payable.amountCents)}
        </span>
      </Link>
    </li>
  )
}

/** O que sai do saldo em "Quanto posso gastar": vencidas primeiro, depois as a vencer até `windowEnd`. */
export function PayablesOverview({
  payables,
  totalCents,
  today,
  windowEnd,
}: {
  payables: Payable[]
  totalCents: number
  today: IsoDate
  windowEnd: IsoDate
}) {
  const overdue = payables.filter((p) => p.dueDate < today)
  const upcoming = payables.filter((p) => p.dueDate >= today)
  const groups = [
    { label: 'Vencidas', items: overdue },
    { label: 'A vencer', items: upcoming },
  ].filter((g) => g.items.length > 0)

  return (
    <Card role="region" className="gap-0 py-0" aria-labelledby="payables-title">
      <header className="flex flex-col gap-2 border-b px-6 py-5">
        <h2 id="payables-title" className={sectionLabel}>
          <CalendarClock className="text-destructive size-4" aria-hidden />A
          pagar
        </h2>
        <p
          className={`text-3xl font-semibold tabular-nums ${totalCents > 0 ? 'text-destructive' : ''}`}
        >
          {formatBRL(totalCents)}
        </p>
      </header>
      {groups.length === 0 ? (
        <p className="text-muted-foreground px-6 py-5 text-sm">
          {`Nada a pagar até ${formatDate(windowEnd)}.`}
        </p>
      ) : (
        groups.map((group) => (
          <section
            key={group.label}
            aria-label={group.label}
            className="border-b last:border-b-0"
          >
            <h3 className="text-muted-foreground px-6 pt-3 text-xs font-medium">
              {group.label}
            </h3>
            <ul className="divide-y py-1">
              {group.items.map((payable) => (
                <PayableRow
                  key={`${payable.kind}:${payable.refId}:${payable.dueDate}`}
                  payable={payable}
                  today={today}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </Card>
  )
}
