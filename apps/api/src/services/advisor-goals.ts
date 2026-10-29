import { type GoalMonth, type GoalTarget, goalProgress } from '@/lib/advisor/goals'
import { annualAnalysis } from '@/lib/finance/annual-analysis'
import { monthlyCategorySpend } from '@/lib/finance/category-limits'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { loadAnalysisInput } from './load-analysis'

export type ActiveGoal = { id: string; target: GoalTarget; startMonth: string }

type GoalRow = {
  id: string
  kind: 'CATEGORY' | 'SAVINGS'
  category: string | null
  targetCents: number | null
  targetPercent: number | null
  startMonth: string
}

function toActiveGoal(row: GoalRow): ActiveGoal {
  const target: GoalTarget =
    row.kind === 'CATEGORY'
      ? { kind: 'CATEGORY', category: row.category ?? '', targetCents: row.targetCents ?? 0 }
      : { kind: 'SAVINGS', targetPercent: row.targetPercent ?? 0 }
  return { id: row.id, target, startMonth: row.startMonth }
}

/** Metas ativas, mais antiga primeiro. */
export async function loadActiveGoals(userId: string): Promise<ActiveGoal[]> {
  const rows = await prisma.advisorGoal.findMany({
    where: { userId, endedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, category: true, targetCents: true, targetPercent: true, startMonth: true },
  })
  return rows.map(toActiveGoal)
}

/** Metas ativas com o andamento; só lê a análise quando há meta. */
export async function loadGoalsWithProgress(
  userId: string,
  today: IsoDate,
): Promise<(ActiveGoal & { months: GoalMonth[] })[]> {
  const goals = await loadActiveGoals(userId)
  if (goals.length === 0) return []
  const analysis = await loadAnalysisInput(userId, today)
  const ctx = {
    months: annualAnalysis(analysis).months,
    spend: monthlyCategorySpend(analysis.transactions, analysis.overrides),
    currentMonth: today.slice(0, 7),
  }
  return goals.map((goal) => ({ ...goal, months: goalProgress(goal.target, goal.startMonth, ctx) }))
}

/** Aceita a meta; a ativa do mesmo alvo (a mesma categoria, ou a de sobra) é encerrada. */
export async function acceptGoal(userId: string, target: GoalTarget, today: IsoDate): Promise<string> {
  const sameTarget =
    target.kind === 'CATEGORY' ? { kind: target.kind, category: target.category } : { kind: target.kind }
  return prisma.$transaction(async (tx) => {
    await tx.advisorGoal.updateMany({
      where: { userId, endedAt: null, ...sameTarget },
      data: { endedAt: new Date() },
    })
    const created = await tx.advisorGoal.create({
      data: {
        userId,
        kind: target.kind,
        category: target.kind === 'CATEGORY' ? target.category : null,
        targetCents: target.kind === 'CATEGORY' ? target.targetCents : null,
        targetPercent: target.kind === 'SAVINGS' ? target.targetPercent : null,
        startMonth: today.slice(0, 7),
      },
      select: { id: true },
    })
    return created.id
  })
}

/** Encerra a meta; `false` quando não existe ou já foi encerrada. */
export async function endGoal(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.advisorGoal.updateMany({
    where: { id, userId, endedAt: null },
    data: { endedAt: new Date() },
  })
  return count > 0
}
