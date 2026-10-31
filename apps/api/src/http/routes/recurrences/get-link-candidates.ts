import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'

import { findOwnedRecurrence } from './owned-recurrence'
import { recurrenceTxSchema, recurrenceTxSelect } from './recurrence-schema'

// Cabe na janela de escolha sem rolagem.
const PAGE_SIZE = 10
const LOOKBACK_DAYS = 365

export async function getLinkCandidates(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/recurrences/:id/link-candidates',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Transactions that can be linked to this recurrence (or only the linked ones), newest first.',
          operationId: 'getRecurrenceLinkCandidates',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          querystring: z.object({
            search: z.string().trim().max(100).optional(),
            page: z.coerce.number().int().min(1).max(1000).default(1),
            linked: z.enum(['true', 'false']).optional(),
          }),
          response: {
            200: z.object({
              total: z.number().int(),
              page: z.number().int(),
              pageSize: z.number().int(),
              items: z.array(
                recurrenceTxSchema.extend({
                  linkedTo: z.object({ id: z.uuid(), description: z.string() }).nullable(),
                  linkedHere: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { search, page, linked } = request.query

        const recurrence = await findOwnedRecurrence(userId, id)
        const payroll = recurrence.payrollDeduction
        // Em folha, a parcela sai do crédito do salário: a escolha é entre entradas.
        const linksIncome = recurrence.direction === 'IN' || payroll
        const linkedHere = payroll ? { payrollLinks: { some: { recurrenceId: id } } } : { recurrenceId: id }
        const where =
          linked === 'true'
            ? { userId, ...linkedHere }
            : {
                userId,
                isTransfer: false,
                amountCents: linksIncome ? { gt: 0 } : { lt: 0 },
                date: { gte: toDbDate(addDays(todayIso(), -LOOKBACK_DAYS)) },
                ...(search ? { description: { contains: search, mode: 'insensitive' as const } } : {}),
              }

        const [rows, total] = await Promise.all([
          prisma.transaction.findMany({
            where,
            select: {
              ...recurrenceTxSelect,
              recurrence: { select: { id: true, description: true } },
              payrollLinks: { where: { recurrenceId: id }, select: { recurrenceId: true } },
            },
            orderBy: [{ date: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
          }),
          prisma.transaction.count({ where }),
        ])

        return reply.send({
          total,
          page,
          pageSize: PAGE_SIZE,
          items: rows.map(({ recurrence: linkedTo, payrollLinks, ...t }) => ({
            ...t,
            date: fromDbDate(t.date),
            // O salário não muda de dono no desconto em folha: não há "de: outro".
            linkedTo: payroll ? null : linkedTo,
            linkedHere: payroll ? payrollLinks.length > 0 : linkedTo?.id === id,
          })),
        })
      },
    )
}
