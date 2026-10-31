import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { payrollCreditIds, pickPayrollSource } from '@/lib/finance/payroll'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'

import { payrollIncomeWhere, recurrenceRuleSelect, toProjectionRecurrence } from './recurrence-view'

/** A ocorrência casa até 5 dias antes da data esperada. */
const MATCH_MARGIN_DAYS = 5

/**
 * Vincula a cada empréstimo em folha o crédito do salário de cada mês, do mês
 * em que ele foi cadastrado em diante (antes disso seria histórico inventado).
 * O que o João desvinculou fica de fora. Devolve quantos vínculos criou.
 */
export async function syncPayrollLinks(userId: string, today: IsoDate = todayIso()): Promise<number> {
  const loans = await prisma.recurrence.findMany({
    where: { userId, payrollDeduction: true, status: 'CONFIRMED' },
    select: { id: true, payrollSourceId: true, createdAt: true, linkDismissals: { select: { transactionId: true } } },
  })
  if (loans.length === 0) return 0

  const startOf = (createdAt: Date): IsoDate => `${createdAt.toISOString().slice(0, 7)}-01`
  const from = loans.map((l) => startOf(l.createdAt)).sort()[0]
  const [incomes, rows] = await Promise.all([
    prisma.recurrence.findMany({ where: payrollIncomeWhere(userId), select: recurrenceRuleSelect }),
    prisma.transaction.findMany({
      where: { userId, isTransfer: false, amountCents: { gt: 0 }, date: { gte: toDbDate(addDays(from, -MATCH_MARGIN_DAYS)) } },
      select: { id: true, accountId: true, date: true, amountCents: true, descriptionKey: true, isTransfer: true, recurrenceId: true },
    }),
  ])
  const txs = rows.map((r) => ({ ...r, date: fromDbDate(r.date) }))

  const data = loans.flatMap((loan) => {
    const source = pickPayrollSource(loan.payrollSourceId, incomes)
    if (!source) return []
    const dismissed = new Set(loan.linkDismissals.map((d) => d.transactionId))
    return payrollCreditIds(toProjectionRecurrence(source), txs, startOf(loan.createdAt), today)
      .filter((id) => !dismissed.has(id))
      .map((transactionId) => ({ recurrenceId: loan.id, transactionId }))
  })
  if (data.length === 0) return 0

  const { count } = await prisma.recurrencePayrollLink.createMany({ data, skipDuplicates: true })
  return count
}
