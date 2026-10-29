import type { AnalysisMonth } from '@/lib/finance/annual-analysis'
import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { formatBrl } from '@/lib/finance/money'

/** O que a meta mede: teto de gasto numa categoria por mês ou % mínima da renda que sobra. */
export type GoalTarget =
  | { kind: 'CATEGORY'; category: string; targetCents: number }
  | { kind: 'SAVINGS'; targetPercent: number }

/** `value` em centavos no teto de categoria e em % na sobra. */
export type GoalMonth = { month: string; value: number; met: boolean; partial: boolean }

const MAX_PROPOSALS = 3
const MAX_TARGET_REAIS = 1_000_000
const MAX_SAVINGS_PERCENT = 90
/** Diferença de renda até isso é "estável". */
const STABLE_INCOME_RATIO = 0.05
const TREND_MONTHS = 3

type SpendByMonth = Map<string, Map<string, number>>

/** Sobra = renda menos todo gasto; o investido não é gasto, conta como sobra. */
function savedPercent(m: AnalysisMonth): number | null {
  if (m.incomeCents <= 0) return null
  const spent = m.essentialCents + m.avoidableCents + m.emergencyCents + m.debtCents + m.unclassifiedCents
  return Math.round(((m.incomeCents - spent) * 100) / m.incomeCents)
}

function spentIn(spend: SpendByMonth, month: string, category: string): number {
  return Math.max(0, spend.get(month)?.get(category) ?? 0)
}

/** Como a meta aparece no texto que vai ao Gemini. */
export function targetText(target: GoalTarget): string {
  return target.kind === 'CATEGORY'
    ? `${target.category} até ${formatBrl(target.targetCents)}/mês`
    : `Sobra de pelo menos ${target.targetPercent}% da renda`
}

/** Uma meta por categoria e uma de sobra. */
function targetKey(target: GoalTarget): string {
  return target.kind === 'CATEGORY' ? `CATEGORY:${target.category}` : 'SAVINGS'
}

function sameTarget(a: GoalTarget, b: GoalTarget): boolean {
  if (a.kind === 'CATEGORY' && b.kind === 'CATEGORY') {
    return a.category === b.category && a.targetCents === b.targetCents
  }
  return a.kind === 'SAVINGS' && b.kind === 'SAVINGS' && a.targetPercent === b.targetPercent
}

/** Andamento da meta de `startMonth` até o mês atual (parcial), mais antigo primeiro. */
export function goalProgress(
  target: GoalTarget,
  startMonth: string,
  ctx: { months: AnalysisMonth[]; spend: SpendByMonth; currentMonth: string },
): GoalMonth[] {
  return ctx.months
    .filter((m) => m.month >= startMonth)
    .flatMap((m) => {
      const partial = m.month === ctx.currentMonth
      if (target.kind === 'CATEGORY') {
        const value = spentIn(ctx.spend, m.month, target.category)
        return [{ month: m.month, value, met: value <= target.targetCents, partial }]
      }
      const value = savedPercent(m)
      return value === null ? [] : [{ month: m.month, value, met: value >= target.targetPercent, partial }]
    })
}

/**
 * Propostas de meta que o Gemini devolveu, validadas: categoria de limite com
 * teto em reais, sobra só com renda configurada, nada igual a meta ativa.
 */
export function parseProposals(
  raw: unknown,
  ctx: { incomeConfigured: boolean; active: GoalTarget[] },
): GoalTarget[] {
  if (!Array.isArray(raw)) return []
  const result: GoalTarget[] = []
  for (const item of raw as Record<string, unknown>[]) {
    let target: GoalTarget | null = null
    const reais = item?.targetReais
    const percent = item?.targetPercent
    if (
      item?.kind === 'CATEGORY' &&
      LIMIT_CATEGORIES.includes(item.category as never) &&
      Number.isInteger(reais) &&
      (reais as number) > 0 &&
      (reais as number) <= MAX_TARGET_REAIS
    ) {
      target = { kind: 'CATEGORY', category: item.category as string, targetCents: (reais as number) * 100 }
    } else if (
      item?.kind === 'SAVINGS' &&
      ctx.incomeConfigured &&
      Number.isInteger(percent) &&
      (percent as number) > 0 &&
      (percent as number) <= MAX_SAVINGS_PERCENT
    ) {
      target = { kind: 'SAVINGS', targetPercent: percent as number }
    }
    if (!target) continue
    if (result.some((t) => targetKey(t) === targetKey(target))) continue
    if (ctx.active.some((t) => sameTarget(t, target))) continue
    result.push(target)
    if (result.length === MAX_PROPOSALS) break
  }
  return result
}

export type AdvisorIndicators = {
  months: { month: string; savedPercent: number | null; essentialPercent: number | null }[]
  /** Média de renda (do salário, quando conhecido) dos 3 últimos meses fechados contra a dos 3 anteriores. */
  incomeTrend: 'UP' | 'DOWN' | 'STABLE' | null
  /** Categorias em alta contínua nos 3 últimos meses fechados. */
  risingCategories: string[]
}

export function advisorIndicators(
  months: AnalysisMonth[],
  spend: SpendByMonth,
  currentMonth: string,
  salaryByMonth?: Map<string, number>,
): AdvisorIndicators {
  const closed = months.filter((m) => m.month < currentMonth)

  let incomeTrend: AdvisorIndicators['incomeTrend'] = null
  const recent = closed.slice(-TREND_MONTHS)
  const before = closed.slice(-2 * TREND_MONTHS, -TREND_MONTHS)
  const income = (m: AnalysisMonth) => (salaryByMonth ? (salaryByMonth.get(m.month) ?? 0) : m.incomeCents)
  const avg = (list: AnalysisMonth[]) => list.reduce((sum, m) => sum + income(m), 0) / list.length
  if (before.length === TREND_MONTHS && avg(before) > 0) {
    const ratio = avg(recent) / avg(before) - 1
    incomeTrend = ratio > STABLE_INCOME_RATIO ? 'UP' : ratio < -STABLE_INCOME_RATIO ? 'DOWN' : 'STABLE'
  }

  const lastClosed = closed.slice(-TREND_MONTHS).map((m) => m.month)
  const risingCategories =
    lastClosed.length < TREND_MONTHS
      ? []
      : LIMIT_CATEGORIES.filter((category) => {
          const values = lastClosed.map((month) => spentIn(spend, month, category))
          return values.every((v, i) => i === 0 || v > values[i - 1])
        })

  return {
    months: months.map((m) => ({
      month: m.month,
      savedPercent: savedPercent(m),
      essentialPercent: m.incomeCents > 0 ? Math.round((m.essentialCents * 100) / m.incomeCents) : null,
    })),
    incomeTrend,
    risingCategories,
  }
}
