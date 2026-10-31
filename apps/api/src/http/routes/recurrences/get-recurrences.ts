import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { isPayrollIncome, loadMonthTxs, recurrenceViewSelect, toRecurrenceView } from '@/services/recurrence-view'

import { recurrenceSchema, recurrenceStatus } from './recurrence-schema'

export async function getRecurrences(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/recurrences',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'List the recurrences of the authenticated user, with this month status and linked transactions.',
          operationId: 'getRecurrences',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ status: recurrenceStatus.optional() }),
          response: { 200: z.object({ recurrences: z.array(recurrenceSchema) }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { status } = request.query
        const today = todayIso()

        const [rows, monthTxs] = await Promise.all([
          prisma.recurrence.findMany({
            select: recurrenceViewSelect,
            where: { userId, ...(status ? { status } : {}) },
            orderBy: [{ dayValue: 'asc' }, { description: 'asc' }],
          }),
          loadMonthTxs(userId, today),
        ])
        const incomes = rows.filter(isPayrollIncome)
        return reply.send({ recurrences: rows.map((row) => toRecurrenceView(row, today, monthTxs, incomes)) })
      },
    )
}
