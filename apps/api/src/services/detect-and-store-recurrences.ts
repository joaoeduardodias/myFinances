import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { detectRecurrenceCandidates, WINDOW_DAYS } from '@/lib/finance/detect-recurrences'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'

/** Grava como `SUGGESTED` as recorrências novas do histórico e devolve quantas criou. */
export async function detectAndStoreRecurrences(
  userId: string,
  today: IsoDate = todayIso(),
): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      isTransfer: false,
      date: { gte: toDbDate(addDays(today, -WINDOW_DAYS)), lte: toDbDate(today) },
    },
    select: {
      accountId: true,
      date: true,
      amountCents: true,
      description: true,
      descriptionKey: true,
      isTransfer: true,
    },
  })
  // Todos os status: o que o usuário descartou ou já confirmou não volta como sugestão.
  const known = await prisma.recurrence.findMany({
    where: { userId },
    select: { accountId: true, descriptionKey: true, direction: true },
  })

  const txs = rows.map((r) => ({ ...r, date: fromDbDate(r.date) }))
  const candidates = detectRecurrenceCandidates(txs, known, today)
  if (candidates.length === 0) return 0

  // `skipDuplicates` cobre a corrida com outro detector; o índice único é a garantia final.
  const { count } = await prisma.recurrence.createMany({
    data: candidates.map((c) => ({ ...c, userId, status: 'SUGGESTED' as const })),
    skipDuplicates: true,
  })
  return count
}
