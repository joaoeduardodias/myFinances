import { loadNecessityOverrides } from '@/http/routes/categories/get-category-necessities'
import type { AnalysisTx } from '@/lib/finance/annual-analysis'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'

export type LoadedAnalysisTx = AnalysisTx & { categoryLocked: boolean }

/** `YYYY-MM` dos 12 meses da análise, mais antigo primeiro. */
export function analysisMonths(today: IsoDate): string[] {
  const [year, month] = today.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 7),
  )
}

/** Transações da janela de 12 meses até hoje, a primeira data do usuário e as trocas de essencial/evitável. */
export async function loadAnalysisInput(userId: string, today: IsoDate = todayIso()) {
  const from = `${analysisMonths(today)[0]}-01`

  const [rows, first, overrides] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) } },
      select: {
        id: true,
        date: true,
        description: true,
        amountCents: true,
        category: true,
        necessity: true,
        categoryLocked: true,
        isTransfer: true,
        account: { select: { type: true, name: true } },
      },
    }),
    prisma.transaction.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
    loadNecessityOverrides(userId),
  ])

  const transactions: LoadedAnalysisTx[] = rows.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    description: t.description,
    amountCents: t.amountCents,
    category: t.category,
    necessity: t.necessity,
    categoryLocked: t.categoryLocked,
    isTransfer: t.isTransfer,
    accountType: t.account.type,
    accountName: t.account.name,
  }))

  return {
    today,
    transactions,
    overrides,
    firstDate: first ? first.date.toISOString().slice(0, 10) : undefined,
  }
}
