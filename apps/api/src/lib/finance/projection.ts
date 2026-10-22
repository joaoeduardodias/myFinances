import type { IsoDate } from '@/lib/today'

import { addDays } from './business-days'
import type { CardBillView } from './card-bills'
import { expectedDates, type RecurrenceRule } from './recurrence-schedule'

type AccountType = 'BANK' | 'CREDIT' | 'WALLET'

export type ProjectionTx = {
  accountId: string
  date: IsoDate
  amountCents: number
  descriptionKey: string
  isTransfer: boolean
}

export type ProjectionRecurrence = RecurrenceRule & {
  id: string
  accountId: string
  accountType: AccountType
  direction: 'IN' | 'OUT'
  description: string
  descriptionKey: string
  expectedAmountCents: number
}

export type Payable = {
  kind: 'BILL' | 'RECURRENCE'
  refId: string
  description: string
  dueDate: IsoDate
  amountCents: number
}

export type Projection = {
  today: IsoDate
  balanceCents: number
  nextIncome: { recurrenceId: string; description: string; date: IsoDate; amountCents: number } | null
  windowEnd: IsoDate
  days: number
  noIncomeConfigured: boolean
  payables: Payable[]
  payableTotalCents: number
  availableCents: number
  perDayCents: number
}

const MATCH_WINDOW_DAYS = 5
const INCOME_LOOKAHEAD_DAYS = 62
const DAY_MS = 86_400_000

/** Dias corridos de `from` até `to` (`to − from`). */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

function lastDayOfMonth(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

/** Conta de dinheiro: recorrente de cartão já está na fatura e não conta à parte. */
function isCashAccount(type: AccountType): boolean {
  return type === 'BANK' || type === 'WALLET'
}

function findOccurrenceTx(
  rec: ProjectionRecurrence,
  expected: IsoDate,
  txs: ProjectionTx[],
): ProjectionTx | undefined {
  const sign = rec.direction === 'IN' ? 1 : -1
  return txs.find(
    (t) =>
      !t.isTransfer &&
      t.accountId === rec.accountId &&
      Math.sign(t.amountCents) === sign &&
      Math.abs(daysBetween(expected, t.date)) <= MATCH_WINDOW_DAYS &&
      (t.descriptionKey === rec.descriptionKey ||
        // Até 10% de diferença, em inteiros para não errar por ponto flutuante.
        10 * Math.abs(Math.abs(t.amountCents) - rec.expectedAmountCents) <= rec.expectedAmountCents),
  )
}

export function isOccurrenceMatched(
  rec: ProjectionRecurrence,
  expected: IsoDate,
  txs: ProjectionTx[],
): boolean {
  return findOccurrenceTx(rec, expected, txs) !== undefined
}

/**
 * Datas esperadas em `[from, to]` ainda sem transação que as cumpra.
 *
 * Cada transação cumpre no máximo uma ocorrência do recorrente, para um
 * depósito não valer por dois meses.
 */
function unmatchedDates(
  rec: ProjectionRecurrence,
  from: IsoDate,
  to: IsoDate,
  txs: ProjectionTx[],
): IsoDate[] {
  let available = txs
  return expectedDates(rec, from, to).filter((date) => {
    const tx = findOccurrenceTx(rec, date, available)
    if (tx) available = available.filter((t) => t !== tx)
    return tx === undefined
  })
}

export function computeProjection(input: {
  today: IsoDate
  accounts: { id: string; type: AccountType; balanceCents: number }[]
  recurrences: ProjectionRecurrence[]
  transactions: ProjectionTx[]
  cardBills: CardBillView[]
}): Projection {
  const { today, accounts, recurrences, transactions, cardBills } = input
  // Ocorrência de até 5 dias atrás que ainda não aconteceu continua valendo.
  const from = addDays(today, -MATCH_WINDOW_DAYS)

  const balanceCents = accounts
    .filter((a) => isCashAccount(a.type))
    .reduce((sum, a) => sum + a.balanceCents, 0)

  const cashRecurrences = recurrences.filter((r) => isCashAccount(r.accountType))

  let nextIncome: Projection['nextIncome'] = null
  for (const rec of cashRecurrences.filter((r) => r.direction === 'IN')) {
    const [date] = unmatchedDates(rec, from, addDays(today, INCOME_LOOKAHEAD_DAYS), transactions)
    if (date === undefined) continue
    // Recebimento atrasado é esperado para hoje, não para o passado.
    const incomeDate = date > today ? date : today
    if (nextIncome === null || incomeDate < nextIncome.date) {
      nextIncome = {
        recurrenceId: rec.id,
        description: rec.description,
        date: incomeDate,
        amountCents: rec.expectedAmountCents,
      }
    }
  }

  const windowEnd = nextIncome?.date ?? lastDayOfMonth(today)

  const recurrencePayables: Payable[] = cashRecurrences
    .filter((r) => r.direction === 'OUT')
    .flatMap((rec) =>
      unmatchedDates(rec, from, windowEnd, transactions).map((dueDate) => ({
        kind: 'RECURRENCE' as const,
        refId: rec.id,
        description: rec.description,
        dueDate,
        amountCents: rec.expectedAmountCents,
      })),
    )

  const billPayables: Payable[] = cardBills
    .filter((b) => b.remainingCents > 0 && b.dueDate >= from && b.dueDate <= windowEnd)
    .map((b) => ({
      kind: 'BILL' as const,
      refId: b.accountId,
      description: 'Fatura do cartão',
      dueDate: b.dueDate,
      amountCents: b.remainingCents,
    }))

  const payables = [...recurrencePayables, ...billPayables].sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
  )
  const payableTotalCents = payables.reduce((sum, p) => sum + p.amountCents, 0)
  // O recebimento que fecha a janela não entra: o dinheiro dele é da próxima.
  const availableCents = balanceCents - payableTotalCents
  const days = Math.max(1, daysBetween(today, windowEnd))

  return {
    today,
    balanceCents,
    nextIncome,
    windowEnd,
    days,
    noIncomeConfigured: nextIncome === null,
    payables,
    payableTotalCents,
    availableCents,
    // `|| 0` evita o `-0` de `Math.trunc(-0.3)`.
    perDayCents: Math.trunc(availableCents / days) || 0,
  }
}
