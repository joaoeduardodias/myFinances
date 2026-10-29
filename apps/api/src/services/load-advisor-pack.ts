import { type AdvisorPack, buildAdvisorPack, fullHistoryStart } from '@/lib/advisor/pack'
import { salaryByMonth } from '@/lib/advisor/salary'
import { toDbDate } from '@/lib/db-date'
import { annualAnalysis } from '@/lib/finance/annual-analysis'
import { monthlyCategorySpend } from '@/lib/finance/category-limits'
import { computeProjection } from '@/lib/finance/projection'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { loadActiveGoals } from './advisor-goals'
import { loadAnalysisInput } from './load-analysis'
import { loadFinanceSnapshot } from './load-finance-snapshot'

/**
 * Renda recorrente confirmada: o salário de cada mês (desde `from`) e a
 * primeira transação da Pluggy de cada conta que a recebe. Salário lançado à
 * mão antes disso não traz os gastos da conta, por isso não conta para o início.
 */
async function loadIncome(userId: string, from: IsoDate) {
  const incomes = await prisma.recurrence.findMany({
    where: { userId, direction: 'IN', status: 'CONFIRMED' },
    select: { accountId: true, descriptionKey: true, expectedAmountCents: true },
  })
  if (incomes.length === 0) return { firstDates: [], salary: undefined }
  const accountIds = [...new Set(incomes.map((r) => r.accountId))]
  const [firsts, credits] = await Promise.all([
    prisma.transaction.groupBy({
      by: ['accountId'],
      where: { userId, accountId: { in: accountIds }, source: 'PLUGGY' },
      _min: { date: true },
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        accountId: { in: accountIds },
        descriptionKey: { in: [...new Set(incomes.map((r) => r.descriptionKey))] },
        amountCents: { gt: 0 },
        isTransfer: false,
        date: { gte: toDbDate(from) },
      },
      select: { accountId: true, descriptionKey: true, date: true, amountCents: true },
    }),
  ])
  return {
    firstDates: firsts.flatMap((f) => (f._min.date ? [f._min.date.toISOString().slice(0, 10)] : [])),
    salary: salaryByMonth(
      credits.map((c) => ({ ...c, date: c.date.toISOString().slice(0, 10) })),
      incomes.map((r) => ({ ...r, expectedAmountCents: Number(r.expectedAmountCents) })),
    ),
  }
}

/** Reúne projeção, análise e limites do usuário no pacote de totais do consultor. */
export async function loadAdvisorPack(userId: string, today: IsoDate): Promise<AdvisorPack> {
  const [snapshot, analysis, limitRows, goals] = await Promise.all([
    loadFinanceSnapshot(userId, today),
    loadAnalysisInput(userId, today),
    prisma.categoryLimit.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { category: true, limitCents: true },
    }),
    loadActiveGoals(userId),
  ])
  const { months } = annualAnalysis(analysis)
  const income = await loadIncome(userId, `${months[0].month}-01`)

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
    months,
    spend: monthlyCategorySpend(analysis.transactions, analysis.overrides),
    limits,
    goals,
    historyStartMonth: fullHistoryStart(income.firstDates),
    salaryByMonth: income.salary,
  })
}
