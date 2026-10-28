import { decideAlerts } from '@/lib/finance/alerts'
import { monthlyCategorySpend } from '@/lib/finance/category-limits'
import { computeProjection } from '@/lib/finance/projection'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { loadAnalysisInput } from './load-analysis'
import { loadFinanceSnapshot } from './load-finance-snapshot'

/**
 * Grava os avisos de saldo negativo e de limite por categoria. Não usa a fila
 * do usuário: quem chama já está nela ou precisa entrar.
 */
export async function checkAlerts(userId: string, today: IsoDate): Promise<void> {
  const [user, snapshot, limitRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { spendableNegative: true } }),
    loadFinanceSnapshot(userId, today),
    prisma.categoryLimit.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { category: true, limitCents: true },
    }),
  ])
  if (!user) return

  const { accounts, cardBills, recurrences, transactions } = snapshot
  const cardNames = Object.fromEntries(
    accounts.filter((a) => a.type === 'CREDIT').map((a) => [a.id, a.name]),
  )
  const projection = computeProjection({ today, accounts, recurrences, transactions, cardBills, cardNames })

  const limits = limitRows.flatMap((l) =>
    l.limitCents === null ? [] : [{ category: l.category, limitCents: l.limitCents }],
  )

  let spent = new Map<string, number>()
  let existingKeys = new Set<string>()
  if (limits.length > 0) {
    const [analysis, existing] = await Promise.all([
      loadAnalysisInput(userId, today),
      prisma.notification.findMany({
        where: { userId, dedupeKey: { startsWith: 'category:' } },
        select: { dedupeKey: true },
      }),
    ])
    spent = monthlyCategorySpend(analysis.transactions, analysis.overrides).get(today.slice(0, 7)) ?? new Map()
    existingKeys = new Set(existing.flatMap((n) => (n.dedupeKey ? [n.dedupeKey] : [])))
  }

  const { notifications, negative } = decideAlerts({
    today,
    projection,
    wasNegative: user.spendableNegative,
    limits,
    spent,
    existingKeys,
  })

  if (notifications.length > 0) {
    await prisma.notification.createMany({
      data: notifications.map((n) => ({ userId, ...n })),
      skipDuplicates: true,
    })
  }
  if (negative !== user.spendableNegative) {
    await prisma.user.update({ where: { id: userId }, data: { spendableNegative: negative } })
  }
}
