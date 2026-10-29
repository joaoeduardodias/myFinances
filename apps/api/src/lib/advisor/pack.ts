import type { AnalysisMonth } from '@/lib/finance/annual-analysis'
import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { formatBrl } from '@/lib/finance/money'
import type { Projection } from '@/lib/finance/projection'
import type { IsoDate } from '@/lib/today'

import {
  type AdvisorIndicators,
  advisorIndicators,
  type GoalMonth,
  type GoalTarget,
  goalProgress,
  targetText,
} from './goals'

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
  /** Até 12 meses terminando no atual, mais antigo primeiro, a partir do primeiro com dado. */
  /** Renda é o salário das recorrências confirmadas; o resto das entradas vai em `otherInCents`. */
  incomeIsSalary: boolean
  months: {
    month: string
    incomeCents: number
    otherInCents: number
    essentialCents: number
    avoidableCents: number
    emergencyCents: number
    debtCents: number
    investedCents: number
  }[]
  /** Gasto por categoria nos mesmos meses de `months`. */
  categoryHistory: { category: string; byMonth: { month: string; spentCents: number }[] }[]
  /** Limites respeitados no último mês fechado; `null` sem limite ativo. */
  limitsKept: { month: string; kept: number; total: number } | null
  indicators: AdvisorIndicators
  /** Primeiro mês completo da conta que recebe a renda na Pluggy; antes dele faltam os gastos dela. */
  historyStartMonth: string | null
  /** Metas ativas com o andamento desde o mês em que foram aceitas. */
  goals: { target: GoalTarget; startMonth: string; months: GoalMonth[] }[]
}

/** Estorno deixa o gasto negativo; no pacote vale zero. */
function spentIn(spend: Map<string, Map<string, number>>, month: string, category: string): number {
  return Math.max(0, spend.get(month)?.get(category) ?? 0)
}

function hasData(m: AnalysisMonth, spend: Map<string, Map<string, number>>): boolean {
  return (
    m.incomeCents + m.essentialCents + m.avoidableCents + m.emergencyCents + m.debtCents + m.investedCents + m.unclassifiedCents !== 0 ||
    (spend.get(m.month)?.size ?? 0) > 0
  )
}

export function buildAdvisorPack(input: {
  today: IsoDate
  projection: Projection
  months: AnalysisMonth[]
  spend: Map<string, Map<string, number>>
  limits: { category: string; limitCents: number }[]
  goals?: { target: GoalTarget; startMonth: string }[]
  historyStartMonth?: string | null
  /** Salário por mês; sem ele, toda entrada conta como renda. */
  salaryByMonth?: Map<string, number>
}): AdvisorPack {
  const { today, projection, spend, limits } = input
  // Meses antes do primeiro dado leriam como gasto zero para o Gemini.
  const first = input.months.findIndex((m) => hasData(m, spend))
  const months = first < 0 ? input.months.slice(-1) : input.months.slice(first)
  const historyStartMonth =
    input.historyStartMonth && months.some((m) => m.month < input.historyStartMonth!) ? input.historyStartMonth : null
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
    incomeIsSalary: input.salaryByMonth !== undefined,
    months: months.map((m) => {
      const incomeCents = input.salaryByMonth ? (input.salaryByMonth.get(m.month) ?? 0) : m.incomeCents
      return {
        month: m.month,
        incomeCents,
        otherInCents: Math.max(0, m.incomeCents - incomeCents),
        essentialCents: m.essentialCents,
        avoidableCents: m.avoidableCents,
        emergencyCents: m.emergencyCents,
        debtCents: m.debtCents,
        investedCents: m.investedCents,
      }
    }),
    categoryHistory,
    limitsKept,
    historyStartMonth,
    indicators: partialBefore(advisorIndicators(months, spend, currentMonth, input.salaryByMonth), historyStartMonth),
    goals: (input.goals ?? []).map((goal) => ({
      ...goal,
      months: goalProgress(goal.target, goal.startMonth, { months: input.months, spend, currentMonth }),
    })),
  }
}

/** Sem os gastos da conta da renda, % de sobra e de essencial enganariam: ficam em branco. */
function partialBefore(indicators: AdvisorIndicators, start: string | null): AdvisorIndicators {
  if (!start) return indicators
  return {
    ...indicators,
    months: indicators.months.map((m) =>
      m.month < start ? { month: m.month, savedPercent: null, essentialPercent: null } : m,
    ),
  }
}

/**
 * Primeiro mês inteiro coberto por todas as contas que recebem renda, a partir
 * da primeira transação de cada uma (a Pluggy traz histórico curto de alguns
 * bancos). `null` sem conta de renda.
 */
export function fullHistoryStart(firstDates: IsoDate[]): string | null {
  if (firstDates.length === 0) return null
  const latest = firstDates.reduce((a, b) => (a > b ? a : b))
  if (latest.slice(8, 10) === '01') return latest.slice(0, 7)
  const year = Number(latest.slice(0, 4))
  const month = Number(latest.slice(5, 7))
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
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

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** "2026-10" em "outubro de 2026": o Gemini repete o formato que recebe (pedido do João). */
function monthName(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`
}

function percent(value: number | null): string {
  return value === null ? '—' : `${value}%`
}

const TREND_TEXT = { UP: 'em alta', DOWN: 'em queda', STABLE: 'estável' } as const

function goalLine(goal: AdvisorPack['goals'][number]): string {
  const { target } = goal
  const label = targetText(target)
  const value = (v: number) => (target.kind === 'CATEGORY' ? money(v) : `${v}%`)
  const progress = goal.months
    .map((m) => `${monthName(m.month)} ${value(m.value)} ${m.partial ? 'até agora' : m.met ? 'cumpriu' : 'estourou'}`)
    .join('; ')
  return `- ${label} desde ${monthName(goal.startMonth)}: ${progress || 'sem dados ainda'}`
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
    lines.push(`Limites respeitados em ${monthName(pack.limitsKept.month)}: ${pack.limitsKept.kept} de ${pack.limitsKept.total}.`)
  }

  if (pack.historyStartMonth) {
    lines.push(
      `Antes de ${monthName(pack.historyStartMonth)} faltam os gastos da conta que recebe a renda: nesses meses os gastos estão incompletos e a sobra não vale.`,
    )
  }
  lines.push(
    `Meses (${pack.incomeIsSalary ? 'salário' : 'renda'}, outras entradas, essencial, evitável, emergência, dívida, investido; sobra e essencial em % de tudo o que entrou):`,
  )
  pack.months.forEach((m, i) => {
    const ind = pack.indicators.months[i]
    lines.push(
      `- ${monthName(m.month)}: ${money(m.incomeCents)}, ${money(m.otherInCents)}, ${money(m.essentialCents)}, ${money(m.avoidableCents)}, ${money(m.emergencyCents)}, ${money(m.debtCents)}, ${money(m.investedCents)}; sobra ${percent(ind.savedPercent)}, essencial ${percent(ind.essentialPercent)}`,
    )
  })
  if (pack.indicators.incomeTrend) {
    lines.push(`Tendência da renda: ${TREND_TEXT[pack.indicators.incomeTrend]}.`)
  }
  if (pack.indicators.risingCategories.length > 0) {
    lines.push(`Em alta nos 3 últimos meses fechados: ${pack.indicators.risingCategories.join(', ')}.`)
  }
  if (pack.goals.length > 0) {
    lines.push('Metas ativas:')
    for (const goal of pack.goals) lines.push(goalLine(goal))
  }

  if (pack.categoryHistory.length > 0) {
    lines.push('Gasto por categoria nos mesmos meses:')
    for (const c of pack.categoryHistory) {
      lines.push(`- ${c.category}: ${c.byMonth.map((m) => `${monthName(m.month)} ${money(m.spentCents)}`).join('; ')}`)
    }
  }

  return lines.join('\n')
}
