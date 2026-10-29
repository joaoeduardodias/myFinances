import { type AdvisorPack, buildAdvisorPack } from '@/lib/advisor/pack'
import { annualAnalysis } from '@/lib/finance/annual-analysis'
import { monthlyCategorySpend } from '@/lib/finance/category-limits'
import { computeProjection } from '@/lib/finance/projection'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { loadActiveGoals } from './advisor-goals'
import { loadAnalysisInput } from './load-analysis'
import { loadFinanceSnapshot } from './load-finance-snapshot'

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
  })
}
