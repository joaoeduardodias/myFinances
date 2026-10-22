import type { IsoDate } from '@/lib/today'

import { addDays, nthBusinessDay } from './business-days'

export type RecurrenceDirection = 'IN' | 'OUT'

export type RecurrenceCandidate = {
  accountId: string
  descriptionKey: string
  description: string
  direction: RecurrenceDirection
  expectedAmountCents: number
  dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'
  dayValue: number
}

type DetectionTx = {
  accountId: string
  date: IsoDate
  amountCents: number
  description: string
  descriptionKey: string
  isTransfer: boolean
}

type KnownRecurrence = {
  accountId: string
  descriptionKey: string
  direction: RecurrenceDirection
}

export const WINDOW_DAYS = 180
const MIN_MONTHS = 3
const AMOUNT_TOLERANCE = 0.1
const MAX_DAY_SPREAD = 6
const MAX_NTH_BUSINESS_DAY = 10

function groupKey(accountId: string, key: string, direction: RecurrenceDirection) {
  return `${accountId}\u0000${key}\u0000${direction}`
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return Math.round(value)
}

/** O `n` (1..10) tal que toda data é o n-ésimo dia útil do seu mês, se houver. */
function commonNthBusinessDay(dates: IsoDate[]): number | null {
  for (let n = 1; n <= MAX_NTH_BUSINESS_DAY; n++) {
    const all = dates.every(
      (date) => nthBusinessDay(Number(date.slice(0, 4)), Number(date.slice(5, 7)), n) === date,
    )
    if (all) return n
  }
  return null
}

/**
 * Sugestões de recorrência a partir do histórico: o mesmo lançamento, na mesma
 * conta e no mesmo sentido, em pelo menos 3 meses, com valor e dia do mês
 * estáveis. Grupos já conhecidos (em qualquer status) não voltam.
 */
export function detectRecurrenceCandidates(
  txs: DetectionTx[],
  known: KnownRecurrence[],
  today: IsoDate,
): RecurrenceCandidate[] {
  const from = addDays(today, -WINDOW_DAYS)
  const knownKeys = new Set(known.map((k) => groupKey(k.accountId, k.descriptionKey, k.direction)))

  const groups = new Map<string, DetectionTx[]>()
  for (const tx of txs) {
    if (tx.isTransfer || tx.amountCents === 0 || !tx.descriptionKey) continue
    if (tx.date < from || tx.date > today) continue
    const direction: RecurrenceDirection = tx.amountCents > 0 ? 'IN' : 'OUT'
    const key = groupKey(tx.accountId, tx.descriptionKey, direction)
    if (knownKeys.has(key)) continue
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const candidates: RecurrenceCandidate[] = []
  for (const group of groups.values()) {
    const months = new Set(group.map((t) => t.date.slice(0, 7)))
    if (months.size < MIN_MONTHS) continue

    const amounts = group.map((t) => Math.abs(t.amountCents))
    const amount = median(amounts)
    if (amounts.some((a) => Math.abs(a - amount) > amount * AMOUNT_TOLERANCE)) continue

    const days = group.map((t) => Number(t.date.slice(8, 10)))
    if (Math.max(...days) - Math.min(...days) > MAX_DAY_SPREAD) continue

    const [first] = group
    const direction: RecurrenceDirection = first.amountCents > 0 ? 'IN' : 'OUT'
    const latest = group.reduce((a, b) => (b.date > a.date ? b : a))
    const nth = direction === 'IN' ? commonNthBusinessDay(group.map((t) => t.date)) : null

    candidates.push({
      accountId: first.accountId,
      descriptionKey: first.descriptionKey,
      description: latest.description,
      direction,
      expectedAmountCents: amount,
      dayRule: nth ? 'NTH_BUSINESS_DAY' : 'DAY_OF_MONTH',
      dayValue: nth ?? median(days),
    })
  }
  return candidates
}
