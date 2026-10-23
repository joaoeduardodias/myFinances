import type { IsoDate } from '@/lib/today'

import { addDays, nthBusinessDay } from './business-days'

export type RecurrenceDirection = 'IN' | 'OUT'

type DayRule = 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'

export type RecurrenceCandidate = {
  accountId: string
  descriptionKey: string
  description: string
  direction: RecurrenceDirection
  expectedAmountCents: number
  dayRule: DayRule
  dayValue: number
  status: 'SUGGESTED' | 'CONFIRMED'
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
  dayRule: DayRule
  dayValue: number
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

/** Crédito que o banco já descreve como salário: basta um mês para virar recorrente. */
function isSalary(direction: RecurrenceDirection, key: string): boolean {
  return direction === 'IN' && /\bsalario\b/.test(key)
}

type DayOfRecurrence = { dayRule: DayRule; dayValue: number }

/** Dia do mês em que a recorrência cai no mês de `date`. */
function dayInMonthOf(rule: DayOfRecurrence, date: IsoDate): number {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  if (rule.dayRule === 'NTH_BUSINESS_DAY') return Number(nthBusinessDay(year, month, rule.dayValue).slice(8, 10))
  return Math.min(rule.dayValue, new Date(Date.UTC(year, month, 0)).getUTCDate())
}

/**
 * Duas regras de dia que, no mês de `date`, caem a até 6 dias uma da outra:
 * são a mesma ocorrência (salário e vale, não).
 */
export function isSameRecurrenceDay(a: DayOfRecurrence, b: DayOfRecurrence, date: IsoDate): boolean {
  return Math.abs(dayInMonthOf(a, date) - dayInMonthOf(b, date)) <= MAX_DAY_SPREAD
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

/** Regra do dia: n-ésimo dia útil se toda data de entrada bater com um; senão, a mediana dos dias. */
function dayRuleOf(group: DetectionTx[], direction: RecurrenceDirection): Pick<RecurrenceCandidate, 'dayRule' | 'dayValue'> {
  const nth = direction === 'IN' ? commonNthBusinessDay(group.map((t) => t.date)) : null
  return nth
    ? { dayRule: 'NTH_BUSINESS_DAY', dayValue: nth }
    : { dayRule: 'DAY_OF_MONTH', dayValue: median(group.map((t) => Number(t.date.slice(8, 10)))) }
}

function latestOf(group: DetectionTx[]): DetectionTx {
  return group.reduce((a, b) => (b.date > a.date ? b : a))
}

/**
 * Salário em um ou mais dias do mês (salário e vale, com a mesma descrição):
 * um recorrente confirmado por dia. Dois créditos no mesmo dia (vale e 13º)
 * valem pelo menor, que é o que se repete. Já conhecido é o do mesmo dia.
 */
function salaryCandidates(group: DetectionTx[], known: KnownRecurrence[]): RecurrenceCandidate[] {
  const byDay = [...group].sort((a, b) => Number(a.date.slice(8, 10)) - Number(b.date.slice(8, 10)))
  const clusters: DetectionTx[][] = []
  for (const tx of byDay) {
    const current = clusters.at(-1)
    const day = Number(tx.date.slice(8, 10))
    if (current && day - Number(current[0].date.slice(8, 10)) <= MAX_DAY_SPREAD) current.push(tx)
    else clusters.push([tx])
  }

  const [first] = group
  return clusters.flatMap((cluster) => {
    const latest = latestOf(cluster)
    const day = dayRuleOf(cluster, 'IN')
    const isKnown = known.some(
      (k) =>
        k.accountId === first.accountId &&
        k.descriptionKey === first.descriptionKey &&
        k.direction === 'IN' &&
        isSameRecurrenceDay(k, day, latest.date),
    )
    if (isKnown) return []

    const smallestByMonth = new Map<string, number>()
    for (const t of cluster) {
      const month = t.date.slice(0, 7)
      smallestByMonth.set(month, Math.min(smallestByMonth.get(month) ?? Infinity, t.amountCents))
    }
    return [
      {
        accountId: first.accountId,
        descriptionKey: first.descriptionKey,
        description: latest.description,
        direction: 'IN' as const,
        expectedAmountCents: median([...smallestByMonth.values()]),
        ...day,
        status: 'CONFIRMED' as const,
      },
    ]
  })
}

/**
 * Sugestões de recorrência a partir do histórico: o mesmo lançamento, na mesma
 * conta e no mesmo sentido, em pelo menos 3 meses, com valor e dia do mês
 * estáveis. Grupos já conhecidos (em qualquer status) não voltam. Salário é
 * exceção: ver `salaryCandidates`.
 */
export function detectRecurrenceCandidates(
  txs: DetectionTx[],
  known: KnownRecurrence[],
  today: IsoDate,
): RecurrenceCandidate[] {
  const from = addDays(today, -WINDOW_DAYS)
  const knownKeys = new Set(known.map((k) => groupKey(k.accountId, k.descriptionKey, k.direction)))

  const groups = new Map<string, DetectionTx[]>()
  const salaryGroups = new Map<string, DetectionTx[]>()
  for (const tx of txs) {
    if (tx.isTransfer || tx.amountCents === 0 || !tx.descriptionKey) continue
    if (tx.date < from || tx.date > today) continue
    const direction: RecurrenceDirection = tx.amountCents > 0 ? 'IN' : 'OUT'
    const key = groupKey(tx.accountId, tx.descriptionKey, direction)
    const target = isSalary(direction, tx.descriptionKey) ? salaryGroups : groups
    if (target === groups && knownKeys.has(key)) continue
    const group = target.get(key)
    if (group) group.push(tx)
    else target.set(key, [tx])
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

    candidates.push({
      accountId: first.accountId,
      descriptionKey: first.descriptionKey,
      description: latestOf(group).description,
      direction,
      expectedAmountCents: amount,
      ...dayRuleOf(group, direction),
      status: 'SUGGESTED',
    })
  }
  for (const group of salaryGroups.values()) candidates.push(...salaryCandidates(group, known))
  return candidates
}
