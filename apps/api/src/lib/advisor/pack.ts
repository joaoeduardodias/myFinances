import type { AnalysisMonth } from '@/lib/finance/annual-analysis'
import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { formatBrl } from '@/lib/finance/money'
import type { Projection } from '@/lib/finance/projection'
import type { IsoDate } from '@/lib/today'

const PACK_MONTHS = 4

export type AdvisorPack = {
  today: IsoDate
  spendable: {
    availableCents: number
    perDayCents: number
    untilDate: IsoDate | null
    /** Fim da projeção: o próximo recebimento ou, sem renda, o último dia do mês. */
    windowEnd: IsoDate
    noIncomeConfigured: boolean
  }
  payables: { dueDate: IsoDate; amountCents: number }[]
  /** Mês de `today`: gasto e limite por categoria de LIMIT_CATEGORIES com gasto ou limite. */
  categories: { category: string; spentCents: number; limitCents: number | null }[]
  /** Os 3 meses fechados antes do atual e o atual, mais antigo primeiro. */
  months: {
    month: string
    incomeCents: number
    essentialCents: number
    avoidableCents: number
    emergencyCents: number
    debtCents: number
  }[]
  /** Gasto por categoria nos mesmos meses de `months`. */
  categoryHistory: { category: string; byMonth: { month: string; spentCents: number }[] }[]
  /** Limites respeitados no último mês fechado; `null` sem limite ativo. */
  limitsKept: { month: string; kept: number; total: number } | null
}

/** Estorno deixa o gasto negativo; no pacote vale zero. */
function spentIn(spend: Map<string, Map<string, number>>, month: string, category: string): number {
  return Math.max(0, spend.get(month)?.get(category) ?? 0)
}

export function buildAdvisorPack(input: {
  today: IsoDate
  projection: Projection
  months: AnalysisMonth[]
  spend: Map<string, Map<string, number>>
  limits: { category: string; limitCents: number }[]
}): AdvisorPack {
  const { today, projection, spend, limits } = input
  const months = input.months.slice(-PACK_MONTHS)
  const currentMonth = today.slice(0, 7)
  const limitByCategory = new Map(limits.map((l) => [l.category, l.limitCents]))

  const categories = LIMIT_CATEGORIES.flatMap((category) => {
    const spentCents = spentIn(spend, currentMonth, category)
    const limitCents = limitByCategory.get(category) ?? null
    return spentCents > 0 || limitCents !== null ? [{ category, spentCents, limitCents }] : []
  })

  const categoryHistory = LIMIT_CATEGORIES.flatMap((category) => {
    const byMonth = months.map((m) => ({ month: m.month, spentCents: spentIn(spend, m.month, category) }))
    return byMonth.some((m) => m.spentCents > 0) ? [{ category, byMonth }] : []
  })

  // Não há histórico de valores de limite: compara o mês fechado com os limites de hoje.
  const lastClosed = months.length >= 2 ? months[months.length - 2].month : null
  const limitsKept =
    lastClosed !== null && limits.length > 0
      ? {
          month: lastClosed,
          kept: limits.filter((l) => spentIn(spend, lastClosed, l.category) <= l.limitCents).length,
          total: limits.length,
        }
      : null

  return {
    today,
    spendable: {
      availableCents: projection.availableCents,
      perDayCents: projection.perDayCents,
      untilDate: projection.nextIncome?.date ?? null,
      windowEnd: projection.windowEnd,
      noIncomeConfigured: projection.noIncomeConfigured,
    },
    payables: projection.payables.map((p) => ({ dueDate: p.dueDate, amountCents: p.amountCents })),
    categories,
    months: months.map((m) => ({
      month: m.month,
      incomeCents: m.incomeCents,
      essentialCents: m.essentialCents,
      avoidableCents: m.avoidableCents,
      emergencyCents: m.emergencyCents,
      debtCents: m.debtCents,
    })),
    categoryHistory,
    limitsKept,
  }
}

/** Pacote vazio: sem gasto, sem limite e sem renda configurada. */
export function isEmptyPack(pack: AdvisorPack): boolean {
  return (
    pack.spendable.noIncomeConfigured &&
    pack.limitsKept === null &&
    !pack.categories.some((c) => c.limitCents !== null) &&
    !pack.categoryHistory.some((c) => c.byMonth.some((m) => m.spentCents > 0))
  )
}

function money(cents: number): string {
  return `${cents < 0 ? '-' : ''}${formatBrl(cents)}`
}

function shortDate(date: IsoDate): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

/** Texto que vai ao Gemini: valores em "R$ 1.234,56", datas DD/MM, nenhum texto do usuário. */
export function packPrompt(pack: AdvisorPack): string {
  const { spendable } = pack
  const lines: string[] = [`Hoje: ${shortDate(pack.today)}`]

  const totals = `${money(spendable.availableCents)} no total, ${money(spendable.perDayCents)} por dia`
  if (spendable.noIncomeConfigured) {
    lines.push('Sem renda configurada.')
    lines.push(`Quanto posso gastar até o fim do mês (${shortDate(spendable.windowEnd)}): ${totals}.`)
  } else {
    lines.push(
      `Quanto posso gastar: ${totals}${spendable.untilDate ? ` até ${shortDate(spendable.untilDate)}` : ''}.`,
    )
  }

  if (pack.payables.length > 0) {
    lines.push('A pagar:')
    for (const p of pack.payables) lines.push(`- ${shortDate(p.dueDate)}: ${money(p.amountCents)}`)
  }

  if (pack.categories.length > 0) {
    lines.push('Categorias no mês (gasto / limite):')
    for (const c of pack.categories) {
      lines.push(`- ${c.category}: ${money(c.spentCents)} / ${c.limitCents === null ? 'sem limite' : money(c.limitCents)}`)
    }
  }

  if (pack.limitsKept) {
    lines.push(`Limites respeitados em ${pack.limitsKept.month}: ${pack.limitsKept.kept} de ${pack.limitsKept.total}.`)
  }

  lines.push('Meses (renda, essencial, evitável, emergência, dívida):')
  for (const m of pack.months) {
    lines.push(
      `- ${m.month}: ${money(m.incomeCents)}, ${money(m.essentialCents)}, ${money(m.avoidableCents)}, ${money(m.emergencyCents)}, ${money(m.debtCents)}`,
    )
  }

  if (pack.categoryHistory.length > 0) {
    lines.push('Gasto por categoria nos mesmos meses:')
    for (const c of pack.categoryHistory) {
      lines.push(`- ${c.category}: ${c.byMonth.map((m) => `${m.month} ${money(m.spentCents)}`).join('; ')}`)
    }
  }

  return lines.join('\n')
}
