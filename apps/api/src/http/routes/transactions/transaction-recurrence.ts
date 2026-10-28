import { fromDbDate } from '@/lib/db-date'
import { isSameRecurrenceDay } from '@/lib/finance/detect-recurrences'
import { prisma } from '@/lib/prisma'

export const recurrenceTxSelect = {
  accountId: true,
  date: true,
  amountCents: true,
  description: true,
  descriptionKey: true,
  isTransfer: true,
  source: true,
  whatsappMessageId: true,
} as const

type RecurrenceTx = {
  accountId: string
  date: Date
  amountCents: number
  descriptionKey: string
  isTransfer: boolean
  source: string
  whatsappMessageId: string | null
}

/** Transferência, lançamento do WhatsApp e texto sem letras ficam fora dos recorrentes. */
export function canBeRecurrence(tx: RecurrenceTx): boolean {
  const whatsappEntry = tx.source === 'MANUAL' && tx.whatsappMessageId !== null
  return !tx.isTransfer && !whatsappEntry && tx.amountCents !== 0 && tx.descriptionKey !== ''
}

/** O recorrente desta transação: mesma conta, texto e sentido, num dia que cai perto do dela. */
export async function findTransactionRecurrence(userId: string, tx: RecurrenceTx) {
  const date = fromDbDate(tx.date)
  const day = { dayRule: 'DAY_OF_MONTH' as const, dayValue: Number(date.slice(8, 10)) }
  const recurrences = await prisma.recurrence.findMany({
    select: { id: true, status: true, dayRule: true, dayValue: true },
    where: {
      userId,
      accountId: tx.accountId,
      descriptionKey: tx.descriptionKey,
      direction: tx.amountCents > 0 ? 'IN' : 'OUT',
    },
  })
  return { day, recurrence: recurrences.find((r) => isSameRecurrenceDay(r, day, date)) ?? null }
}
