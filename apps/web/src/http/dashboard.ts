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
}

export function getDashboard() {
  return api.get('dashboard').json<Dashboard>()
}

export function syncAll(force = false) {
  return api
    .post('sync', { searchParams: { force }, timeout: PLUGGY_SYNC_TIMEOUT_MS })
    .json<{ synced: number }>()
}
