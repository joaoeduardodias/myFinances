import { type AdvisorPack, buildAdvisorPack, fullHistoryStart } from '@/lib/advisor/pack'
import { annualAnalysis } from '@/lib/finance/annual-analysis'
import { monthlyCategorySpend } from '@/lib/finance/category-limits'
import { computeProjection } from '@/lib/finance/projection'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { loadActiveGoals } from './advisor-goals'
import { loadAnalysisInput } from './load-analysis'
import { loadFinanceSnapshot } from './load-finance-snapshot'

/**
 * Primeira transação da Pluggy de cada conta com renda recorrente confirmada.
 * Salário lançado à mão antes disso não traz os gastos da conta: não conta.
 */
async function incomeAccountsFirstDates(userId: string): Promise<IsoDate[]> {
  const incomes = await prisma.recurrence.findMany({
    where: { userId, direction: 'IN', status: 'CONFIRMED' },
    select: { accountId: true },
  })
  const accountIds = [...new Set(incomes.map((r) => r.accountId))]
  if (accountIds.length === 0) return []
  const firsts = await prisma.transaction.groupBy({
    by: ['accountId'],
    where: { userId, accountId: { in: accountIds }, source: 'PLUGGY' },
    _min: { date: true },
  })
  return firsts.flatMap((f) => (f._min.date ? [f._min.date.toISOString().slice(0, 10)] : []))
}

/** Reúne projeção, análise e limites do usuário no pacote de totais do consultor. */
export async function loadAdvisorPack(userId: string, today: IsoDate): Promise<AdvisorPack> {
  const [snapshot, analysis, limitRows, goals, incomeFirstDates] = await Promise.all([
    loadFinanceSnapshot(userId, today),
    loadAnalysisInput(userId, today),
    prisma.categoryLimit.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { category: true, limitCents: true },
    }),
    loadActiveGoals(userId),
    incomeAccountsFirstDates(userId),
  ])

  const { accounts, cardBills, recurrences, transactions } = snapshot
  const cardNames = Object.fromEntries(
    accounts.filter((a) => a.type === 'CREDIT').map((a) => [a.id, a.name]),
  )
  const projection = computeProjection({ today, accounts, recurrences, transactions, cardBills, cardNames })

  const limits = limitRows.flatMap((l) =>
    l.limitCents === null ? [] : [{ category: l.category, limitCents: l.limitCents }],
  )

  return buildAdvisorPack({
    today,
    projection,
    months: annualAnalysis(analysis).months,
    spend: monthlyCategorySpend(analysis.transactions, analysis.overrides),
    limits,
    goals,
    historyStartMonth: fullHistoryStart(incomeFirstDates),
  })
}
