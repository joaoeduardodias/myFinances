import { nthBusinessDay } from '@/lib/finance/business-days'
import type { IsoDate } from '@/lib/today'

export type PayslipType = 'MONTHLY' | 'ADVANCE' | 'THIRTEENTH' | 'VACATION'

/** Diferença aceita entre o líquido e o depósito: até R$ 1,00. */
export const RECONCILIATION_TOLERANCE_CENTS = 100

/**
 * Onde procurar o depósito de um holerite: do 1º dia da competência ao dia 15
 * do mês seguinte, preferindo o mais perto do dia em que ele costuma cair — o
 * 5º dia útil do mês seguinte, ou o dia 20 da própria competência no
 * adiantamento. 13º e férias usam o mesmo alvo do mensal.
 */
export function reconciliationWindow(competence: string, type: PayslipType) {
  const year = Number(competence.slice(0, 4))
  const month = Number(competence.slice(5, 7))
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextPrefix = `${nextYear}-${String(nextMonth).padStart(2, '0')}`

  return {
    from: `${competence}-01`,
    to: `${nextPrefix}-15`,
    target:
      type === 'ADVANCE'
        ? `${competence}-20`
        : nthBusinessDay(nextYear, nextMonth, 5),
  }
}

function distanceInDays(a: IsoDate, b: IsoDate) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/** A de data mais próxima do alvo; no empate, a mais cedo. */
export function closestDeposit<T extends { date: IsoDate }>(
  candidates: T[],
  target: IsoDate,
): T | null {
  let best: T | null = null
  for (const candidate of candidates) {
    if (!best) {
      best = candidate
      continue
    }
    const diff = distanceInDays(candidate.date, target) - distanceInDays(best.date, target)
    if (diff < 0 || (diff === 0 && candidate.date < best.date)) best = candidate
  }
  return best
}
