import { ChevronDown, CreditCard, Landmark, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Card } from '@/components/ui/card'
import type { BankGroup, CardsSummary } from '@/http/dashboard'
import { formatBRL } from '@/lib/format'

const share = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
})

const sectionLabel =
  'text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wider uppercase'

function balanceClass(cents: number) {
  return cents < 0 ? 'text-destructive' : 'text-income'
}

/** No cartão, positivo é o devido (vermelho, mesmo zerado); negativo é crédito a favor. */
function cardBalanceClass(cents: number) {
  return cents < 0 ? 'text-income' : 'text-destructive'
}

/** Logo do banco; sem URL, ou se a imagem não carregar, o ícone genérico. */
function InstitutionLogo({ group }: { group: BankGroup }) {
  const [failed, setFailed] = useState(false)
  const Icon = group.kind === 'WALLET' ? Wallet : Landmark
  return (
    <span className="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full">
      {group.logoUrl && !failed ? (
        <img
          src={group.logoUrl}
          alt=""
          className="size-6 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="text-muted-foreground size-4" aria-hidden />
      )}
    </span>
  )
}

function BankRow({
  group,
  totalCents,
}: {
  group: BankGroup
  totalCents: number
}) {
  const count = group.accounts.length
  const meta = [`${count} ${count === 1 ? 'conta' : 'contas'}`]
  if (totalCents > 0) meta.push(share.format(group.balanceCents / totalCents))

  return (
    <li>
      <details className="group">
        <summary className="hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer list-none items-center gap-3 px-6 py-3 transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          <InstitutionLogo group={group} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{group.name}</span>
            <span className="text-muted-foreground block text-xs">
              {meta.join(' · ')}
            </span>
          </span>
          <span
            className={`font-semibold tabular-nums ${balanceClass(group.balanceCents)}`}
          >
            {formatBRL(group.balanceCents)}
          </span>
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ul className="bg-muted/30 pb-1">
          {group.accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-baseline gap-3 py-2 pr-13 pl-18 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {account.name}
                {account.number && (
                  <span className="text-muted-foreground">
                    {' '}
                    · {account.number}
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {formatBRL(account.balanceCents)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

export function BanksOverview({
  banks,
}: {
  banks: { totalCents: number; groups: BankGroup[] }
}) {
  return (
    <Card role="region" className="gap-0 py-0" aria-labelledby="banks-title">
      <header className="flex flex-col gap-2 border-b px-6 py-5">
        <h2 id="banks-title" className={sectionLabel}>
          <Landmark className="text-destructive size-4" aria-hidden />
          Contas bancárias
        </h2>
        <p className="text-3xl font-semibold tabular-nums">
          {formatBRL(banks.totalCents)}
        </p>
      </header>
      {banks.groups.length === 0 ? (
        <p className="text-muted-foreground px-6 py-5 text-sm">
          Nenhuma conta conectada.
        </p>
      ) : (
        <ul className="divide-y py-1">
          {banks.groups.map((group) => (
            <BankRow
              key={group.key}
              group={group}
              totalCents={banks.totalCents}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

export function CardsOverview({ cards }: { cards: CardsSummary }) {
  const used =
    cards.limitCents && cards.limitCents > 0
      ? Math.min(Math.max(cards.limitUsedCents / cards.limitCents, 0), 1)
      : null

  return (
    <Card role="region" className="gap-0 py-0" aria-labelledby="cards-title">
      <header className="flex flex-col gap-2 border-b px-6 py-5">
        <h2 id="cards-title" className={sectionLabel}>
          <CreditCard className="text-destructive size-4" aria-hidden />
          Cartões de crédito
        </h2>
        <p
          className={`text-3xl font-semibold tabular-nums ${cardBalanceClass(cards.totalCents)}`}
        >
          {formatBRL(cards.totalCents)}
        </p>
      </header>
      {used !== null && cards.limitCents !== null && (
        <div className="flex flex-col gap-2 border-b px-6 py-4">
          <div className="text-muted-foreground flex justify-between gap-3 text-xs">
            <span>{`${Math.round(used * 100)}% utilizado`}</span>
            <span className="tabular-nums">{`Limite: ${formatBRL(cards.limitCents)}`}</span>
          </div>
          <div
            role="progressbar"
            aria-label="Limite utilizado"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(used * 100)}
            className="bg-muted h-2 overflow-hidden rounded-full"
          >
            <div
              className="bg-destructive/80 h-full rounded-full transition-all duration-500"
              style={{ width: `${used * 100}%` }}
            />
          </div>
        </div>
      )}
      {cards.items.length === 0 ? (
        <p className="text-muted-foreground px-6 py-5 text-sm">
          Nenhum cartão de crédito.
        </p>
      ) : (
        <ul className="divide-y py-1">
          {cards.items.map((card) => (
            <li key={card.id} className="flex items-center gap-3 px-6 py-3">
              <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
                <CreditCard
                  className="text-muted-foreground size-4"
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{card.name}</span>
                {card.number && (
                  <span className="text-muted-foreground block text-xs">
                    {`xxxx ${card.number}`}
                  </span>
                )}
              </span>
              <span
                className={`font-semibold tabular-nums ${cardBalanceClass(card.balanceCents)}`}
              >
                {formatBRL(card.balanceCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
