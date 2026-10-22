import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { type CardBillView, computeCardBills } from '@/lib/finance/card-bills'
import type { AccountType, ProjectionRecurrence, ProjectionTx } from '@/lib/finance/projection'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

/** Cobre a fatura fechada mais antiga e as parcelas futuras com folga. */
const SNAPSHOT_WINDOW_DAYS = 400

export type SnapshotAccount = {
  id: string
  type: AccountType
  name: string
  number: string | null
  balanceCents: number
  closingDay: number | null
  dueDay: number | null
}

export type FinanceSnapshot = {
  accounts: SnapshotAccount[]
  cardBills: CardBillView[]
  cardsMissingCycle: { id: string; name: string }[]
  recurrences: ProjectionRecurrence[]
  transactions: ProjectionTx[]
}

/** Tudo que o painel e as faturas precisam do usuário, já no formato das funções puras. */
export async function loadFinanceSnapshot(userId: string, today: IsoDate): Promise<FinanceSnapshot> {
  const [accounts, txRows, billRows, recurrenceRows] = await Promise.all([
    prisma.account.findMany({
      select: {
        id: true,
        type: true,
        name: true,
        number: true,
        balanceCents: true,
        closingDay: true,
        dueDay: true,
      },
      where: { userId },
      orderBy: { name: 'asc' },
    }),
    prisma.transaction.findMany({
      select: {
        accountId: true,
        date: true,
        amountCents: true,
        description: true,
        descriptionKey: true,
        isTransfer: true,
        installmentNumber: true,
        totalInstallments: true,
      },
      where: {
        userId,
        date: {
          gte: toDbDate(addDays(today, -SNAPSHOT_WINDOW_DAYS)),
          lte: toDbDate(addDays(today, SNAPSHOT_WINDOW_DAYS)),
        },
      },
      orderBy: { date: 'asc' },
    }),
    prisma.cardBill.findMany({
      select: { accountId: true, dueDate: true, totalCents: true, paidCents: true },
      where: { userId },
    }),
    prisma.recurrence.findMany({
      select: {
        id: true,
        accountId: true,
        description: true,
        descriptionKey: true,
        direction: true,
        expectedAmountCents: true,
        dayRule: true,
        dayValue: true,
        nonBusinessDayPolicy: true,
        account: { select: { type: true } },
      },
      where: { userId, status: 'CONFIRMED' },
    }),
  ])

  const rows = txRows.map((r) => ({ ...r, date: fromDbDate(r.date) }))

  const cards = accounts.filter((a) => a.type === 'CREDIT')
  const cardsMissingCycle = cards
    .filter((a) => a.closingDay === null || a.dueDay === null)
    .map(({ id, name }) => ({ id, name }))

  const cardBills = cards.flatMap(({ id, closingDay, dueDay }) => {
    if (closingDay === null || dueDay === null) return []
    return computeCardBills({
      accountId: id,
      closingDay,
      dueDay,
      transactions: rows
        .filter((r) => r.accountId === id)
        .map((r) => ({
          date: r.date,
          amountCents: r.amountCents,
          isTransfer: r.isTransfer,
          installmentNumber: r.installmentNumber,
          totalInstallments: r.totalInstallments,
          description: r.description,
        })),
      pluggyBills: billRows
        .filter((b) => b.accountId === id)
        .map((b) => ({ dueDate: fromDbDate(b.dueDate), totalCents: b.totalCents, paidCents: b.paidCents })),
      today,
    })
  })

  const recurrences = recurrenceRows.map(({ account, ...rec }) => ({ ...rec, accountType: account.type }))

  const transactions = rows.map((r) => ({
    accountId: r.accountId,
    date: r.date,
    amountCents: r.amountCents,
    descriptionKey: r.descriptionKey,
    isTransfer: r.isTransfer,
  }))

  return { accounts, cardBills, cardsMissingCycle, recurrences, transactions }
}
