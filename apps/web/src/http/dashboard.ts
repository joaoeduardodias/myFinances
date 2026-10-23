import type { IsoDate } from '@/lib/types'

import { api } from './api'
import { PLUGGY_SYNC_TIMEOUT_MS } from './connections'

export interface Payable {
  kind: 'BILL' | 'RECURRENCE'
  refId: string
  description: string
  dueDate: IsoDate
  amountCents: number
}

export interface AccountLine {
  id: string
  name: string
  number: string | null
  balanceCents: number
}

export interface BankGroup {
  key: string
  kind: 'BANK' | 'WALLET'
  name: string
  logoUrl: string | null
  balanceCents: number
  accounts: AccountLine[]
}

export interface CardsSummary {
  totalCents: number
  /** Soma dos limites; os cartões sem limite ficam fora dela e de `limitUsedCents`. */
  limitCents: number | null
  limitUsedCents: number
  items: (AccountLine & { creditLimitCents: number | null })[]
}

export interface Dashboard {
  today: IsoDate
  balanceCents: number
  nextIncome: {
    recurrenceId: string
    description: string
    date: IsoDate
    amountCents: number
  } | null
  windowEnd: IsoDate
  days: number
  noIncomeConfigured: boolean
  payables: Payable[]
  payableTotalCents: number
  availableCents: number
  perDayCents: number
  cardsMissingCycle: { id: string; name: string }[]
  banks: { totalCents: number; groups: BankGroup[] }
  cards: CardsSummary
}

export function getDashboard() {
  return api.get('dashboard').json<Dashboard>()
}

export function syncAll(force = false) {
  return api
    .post('sync', { searchParams: { force }, timeout: PLUGGY_SYNC_TIMEOUT_MS })
    .json<{ synced: number }>()
}
