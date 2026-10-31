import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { findOccurrenceTx, type ProjectionRecurrence, type ProjectionTx } from '@/lib/finance/projection'
import { expectedDates } from '@/lib/finance/recurrence-schedule'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'
import {
  loadPayrollIncomes,
  recurrenceViewSelect,
  toProjectionRecurrence,
  toRecurrenceView,
} from '@/services/recurrence-view'

import { NotFoundError } from '../_errors/not-found-error'
import { recurrenceSchema, recurrenceTxSchema, recurrenceTxSelect } from './recurrence-schema'

const HISTORY_MONTHS = 6
const LINKED_PREVIEW = 10
const MAX_SUGGESTIONS = 3
/** As parecidas olham as ocorrências dos últimos 2 meses (e a que está para cair). */
const SUGGESTION_LOOKBACK_DAYS = 62
const MATCH_MARGIN_DAYS = 5

/** `YYYY-MM` de `count` meses até o de `today`, do mais antigo para o atual. */
function lastMonths(today: IsoDate, count: number): string[] {
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1
  return Array.from({ length: count }, (_, i) => {
    const m = index - (count - 1 - i)
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
  })
}

function lastDayOf(month: string): IsoDate {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

/** Valor de cada mês: a ocorrência (vinculada ou pela regra) de cada data esperada. */
function monthlyAmounts(rec: ProjectionRecurrence, months: string[], txs: ProjectionTx[]) {
  return months.map((month) => {
    let available = txs
    const amountCents = expectedDates(rec, `${month}-01`, lastDayOf(month)).reduce((sum, date) => {
      const tx = findOccurrenceTx(rec, date, available)
      if (!tx) return sum
      available = available.filter((t) => t !== tx)
      return sum + Math.abs(tx.amountCents)
    }, 0)
    return { month, amountCents }
  })
}

/** Em folha, o mês com salário vinculado teve a parcela descontada. */
function payrollMonthlyAmounts(links: { transaction: { date: Date } }[], months: string[], amountCents: number) {
  const paid = new Set(links.map((l) => fromDbDate(l.transaction.date).slice(0, 7)))
  return months.map((month) => ({ month, amountCents: paid.has(month) ? amountCents : 0 }))
}

/** Transações sem vínculo que a regra casaria com uma ocorrência recente. Nada é vinculado sozinho. */
function suggestedTxs<T extends ProjectionTx>(rec: ProjectionRecurrence, today: IsoDate, txs: T[]): T[] {
  // Em folha o vínculo é com o crédito do salário, que a regra do empréstimo não reconhece.
  if (rec.kind === 'EXTERNAL' || rec.payrollDeduction) return []
  const free = txs.filter((t) => t.recurrenceId == null)
  const found = new Set<T>()
  const dates = expectedDates(rec, addDays(today, -SUGGESTION_LOOKBACK_DAYS), addDays(today, MATCH_MARGIN_DAYS))
  for (const date of dates.reverse()) {
    const tx = findOccurrenceTx(rec, date, free) as T | undefined
    if (tx) found.add(tx)
  }
  return [...found].slice(0, MAX_SUGGESTIONS)
}

export async function getRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/recurrences/:id',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Recurrence detail: last 6 months, linked transactions and unlinked look-alikes.',
          operationId: 'getRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: {
            200: z.object({
              recurrence: recurrenceSchema,
              months: z.array(z.object({ month: z.string(), amountCents: z.number().int() })),
              linked: z.object({ total: z.number().int(), items: z.array(recurrenceTxSchema) }),
              suggestions: z.array(recurrenceTxSchema),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const today = todayIso()

        const row = await prisma.recurrence.findFirst({ select: recurrenceViewSelect, where: { id, userId } })
        if (!row) throw new NotFoundError('Recorrência não encontrada.')

        const months = lastMonths(today, HISTORY_MONTHS)
        const from = addDays(`${months[0]}-01`, -MATCH_MARGIN_DAYS)
        const linkedWhere = row.payrollDeduction
          ? { userId, payrollLinks: { some: { recurrenceId: id } } }
          : { userId, recurrenceId: id }
        const [windowRows, linkedRows, linkedTotal, dismissals, incomes] = await Promise.all([
          prisma.transaction.findMany({
            where: { userId, date: { gte: toDbDate(from) } },
            select: { ...recurrenceTxSelect, accountId: true, descriptionKey: true, isTransfer: true, recurrenceId: true },
            orderBy: { date: 'asc' },
          }),
          prisma.transaction.findMany({
            where: linkedWhere,
            select: recurrenceTxSelect,
            orderBy: { date: 'desc' },
            take: LINKED_PREVIEW,
          }),
          prisma.transaction.count({ where: linkedWhere }),
          prisma.recurrenceLinkDismissal.findMany({ where: { recurrenceId: id }, select: { transactionId: true } }),
          loadPayrollIncomes(userId, row),
        ])

        const txs = windowRows.map((t) => ({ ...t, date: fromDbDate(t.date) }))
        const rec = toProjectionRecurrence({ ...row, account: row.account ? { type: row.account.type } : null })
        const dismissed = new Set(dismissals.map((d) => d.transactionId))
        const toItem = (t: { id: string; date: IsoDate; description: string; amountCents: number; account: { name: string } }) => ({
          id: t.id,
          date: t.date,
          description: t.description,
          amountCents: t.amountCents,
          account: t.account,
        })

        return reply.send({
          recurrence: toRecurrenceView(row, today, txs, incomes),
          months: row.payrollDeduction
            ? payrollMonthlyAmounts(row.payrollLinks, months, row.expectedAmountCents)
            : monthlyAmounts(rec, months, txs),
          linked: { total: linkedTotal, items: linkedRows.map((t) => toItem({ ...t, date: fromDbDate(t.date) })) },
          suggestions: suggestedTxs(rec, today, txs.filter((t) => !dismissed.has(t.id))).map(toItem),
        })
      },
    )
}
