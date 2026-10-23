import { INSTITUTIONS } from '@/lib/pluggy/institutions'

import type { AccountType } from './projection'

export type OverviewAccount = {
  id: string
  type: AccountType
  name: string
  number: string | null
  balanceCents: number
  creditLimitCents: number | null
  connectionId: string | null
  institutionCode: string | null
}

type AccountLine = Pick<OverviewAccount, 'id' | 'name' | 'number' | 'balanceCents'>

export type BankGroup = {
  key: string
  kind: 'BANK' | 'WALLET'
  name: string
  logoUrl: string | null
  balanceCents: number
  accounts: AccountLine[]
}

export type AccountsOverview = {
  banks: { totalCents: number; groups: BankGroup[] }
  cards: {
    totalCents: number
    /** Soma dos limites; os cartões sem limite ficam fora dela e de `limitUsedCents`. */
    limitCents: number | null
    limitUsedCents: number
    items: (AccountLine & { creditLimitCents: number | null })[]
  }
}

const line = ({ id, name, number, balanceCents }: OverviewAccount): AccountLine => ({
  id,
  name,
  number,
  balanceCents,
})

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0)

/** Contas por banco (a Carteira à parte, no fim) e cartões, como no meu.pluggy. */
export function accountsOverview(accounts: OverviewAccount[]): AccountsOverview {
  const groups = new Map<string, BankGroup>()
  for (const account of accounts) {
    if (account.type === 'CREDIT') continue
    const wallet = account.type === 'WALLET'
    const known = account.institutionCode ? INSTITUTIONS[account.institutionCode] : undefined
    // Sem código do banco, cada conexão é um grupo.
    const key = wallet ? 'wallet' : (account.institutionCode ?? account.connectionId ?? account.id)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        kind: wallet ? 'WALLET' : 'BANK',
        name: known?.name ?? account.name,
        logoUrl: known?.logoUrl ?? null,
        balanceCents: 0,
        accounts: [],
      }
      groups.set(key, group)
    }
    group.balanceCents += account.balanceCents
    group.accounts.push(line(account))
  }
  const sorted = [...groups.values()].sort(
    (a, b) =>
      Number(a.kind === 'WALLET') - Number(b.kind === 'WALLET') || b.balanceCents - a.balanceCents,
  )

  const cards = accounts.filter((a) => a.type === 'CREDIT')
  const limited = cards.filter((c) => c.creditLimitCents !== null)
  return {
    banks: { totalCents: sum(sorted.map((g) => g.balanceCents)), groups: sorted },
    cards: {
      totalCents: sum(cards.map((c) => c.balanceCents)),
      limitCents: limited.length > 0 ? sum(limited.map((c) => c.creditLimitCents ?? 0)) : null,
      limitUsedCents: sum(limited.map((c) => c.balanceCents)),
      items: cards.map((c) => ({ ...line(c), creditLimitCents: c.creditLimitCents })),
    },
  }
}
