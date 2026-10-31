import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { similarTxIds } from '@/lib/finance/link-similar'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'

const LOOKBACK_DAYS = 365

const linkTxSelect = {
  id: true,
  date: true,
  amountCents: true,
  descriptionKey: true,
  isTransfer: true,
  recurrenceId: true,
} as const

/**
 * A partir do que o João vinculou, vincula as transações livres que repetem o
 * padrão (mesmo texto do banco ou mesmo valor exato, uma por mês), no último
 * ano. Roda ao vincular e a cada sincronização. Devolve quantas vinculou.
 */
export async function linkSimilarTransactions(
  userId: string,
  { today = todayIso(), recurrenceIds }: { today?: IsoDate; recurrenceIds?: string[] } = {},
): Promise<number> {
  // Em folha o vínculo é com o salário (outra regra); fora da Pluggy não tem transação.
  const recurrences = await prisma.recurrence.findMany({
    where: {
      userId,
      status: 'CONFIRMED',
      payrollDeduction: false,
      kind: { not: 'EXTERNAL' },
      ...(recurrenceIds && { id: { in: recurrenceIds } }),
      transactions: { some: {} },
    },
    select: { id: true, transactions: { select: linkTxSelect }, linkDismissals: { select: { transactionId: true } } },
  })
  if (recurrences.length === 0) return 0

  const rows = await prisma.transaction.findMany({
    where: { userId, recurrenceId: null, isTransfer: false, date: { gte: toDbDate(addDays(today, -LOOKBACK_DAYS)) } },
    select: linkTxSelect,
  })
  const toLinkTx = <T extends { date: Date }>(t: T) => ({ ...t, date: fromDbDate(t.date) })
  let free = rows.map(toLinkTx)

  let total = 0
  for (const recurrence of recurrences) {
    const ids = similarTxIds(
      recurrence.transactions.map(toLinkTx),
      free,
      new Set(recurrence.linkDismissals.map((d) => d.transactionId)),
    )
    if (ids.length === 0) continue
    const taken = new Set(ids)
    free = free.filter((t) => !taken.has(t.id))
    // `recurrenceId: null` no filtro: o que o João vinculou nesse meio tempo não muda de dono.
    const { count } = await prisma.transaction.updateMany({
      where: { id: { in: ids }, userId, recurrenceId: null },
      data: { recurrenceId: recurrence.id },
    })
    total += count
  }
  return total
}
