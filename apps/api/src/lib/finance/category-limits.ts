import type { IsoDate } from '@/lib/today'

import { type AnalysisTx, classify } from './annual-analysis'
import { CATEGORIES, type Category, isNecessityCategory, type Necessity } from './categories'

export const PROPOSAL_MONTHS = 6
export const REVISION_MONTHS = 3

const ROUND_CENTS = 1000
const LOW_USE_RATIO = 0.6

/** Categorias que aceitam limite: as de gasto essencial/evitável, na ordem de `CATEGORIES`. */
export const LIMIT_CATEGORIES: Category[] = CATEGORIES.filter(isNecessityCategory)

const LIMIT_SET = new Set<string>(LIMIT_CATEGORIES)

/** Gasto por mês (`YYYY-MM`) e categoria, em centavos positivos; crédito abate. */
export function monthlyCategorySpend(
  transactions: AnalysisTx[],
  overrides: Map<string, Necessity>,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>()
  for (const tx of transactions) {
    if (tx.category === null || !LIMIT_SET.has(tx.category)) continue
    if (classify(tx, overrides).kind !== 'spend') continue
    const month = tx.date.slice(0, 7)
    let byCategory = result.get(month)
    if (!byCategory) {
      byCategory = new Map()
      result.set(month, byCategory)
    }
    byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) - tx.amountCents)
  }
  return result
}

/** Os `count` meses antes do de `today`, do mais antigo ao mais novo, sem os anteriores à primeira transação. */
export function closedMonths(today: IsoDate, count: number, firstDate: IsoDate | undefined): string[] {
  if (!firstDate) return []
  const [year, month] = today.split('-').map(Number)
  const first = firstDate.slice(0, 7)
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 - count + i, 1)).toISOString().slice(0, 7)).filter(
    (m) => m >= first,
  )
}

/** Mediana do histórico, arredondada para cima em R$ 10; `null` sem histórico ou sem gasto. */
export function proposeLimit(history: number[]): number | null {
  if (history.length === 0) return null
  const sorted = [...history].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  if (median <= 0) return null
  return Math.ceil(median / ROUND_CENTS) * ROUND_CENTS
}

/** Passou do limite em 2 dos 3 últimos meses, ou ficou abaixo de 60% dele nos 3. */
export function needsRevision(limitCents: number, lastThree: number[]): boolean {
  if (lastThree.length !== REVISION_MONTHS) return false
  const over = lastThree.filter((s) => s > limitCents).length
  return over >= 2 || lastThree.every((s) => s < limitCents * LOW_USE_RATIO)
}
