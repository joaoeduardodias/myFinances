import type { IsoDate } from '@/lib/types'

import { api } from './api'

export type BillStatus = 'CLOSED' | 'OPEN' | 'FUTURE'

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  CLOSED: 'Fechada',
  OPEN: 'Aberta',
  FUTURE: 'Futura',
}

export interface BillTransaction {
  date: IsoDate
  amountCents: number
  isTransfer: boolean
  installmentNumber: number | null
  totalInstallments: number | null
  description: string
}

export interface Bill {
  accountId: string
  closeDate: IsoDate
  dueDate: IsoDate
  amountCents: number
  paidCents: number
  remainingCents: number
  status: BillStatus
  transactions: BillTransaction[]
}

export interface CardAccount {
  id: string
  name: string
  number: string | null
  balanceCents: number
  closingDay: number | null
  dueDay: number | null
}

export interface CardsResponse {
  cards: { account: CardAccount; bills: Bill[] }[]
  cardsMissingCycle: { id: string; name: string }[]
}

/** A fatura aberta; sem ela, a primeira da lista. */
export function currentBill(bills: Bill[]): Bill | undefined {
  return bills.find((b) => b.status === 'OPEN') ?? bills[0]
}

export function listCards() {
  return api.get('cards').json<CardsResponse>()
}

export async function updateCardCycle(
  accountId: string,
  cycle: { closingDay: number; dueDay: number },
) {
  await api.patch(`cards/${accountId}`, { json: cycle })
}
