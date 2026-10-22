import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { computeProjection } from '@/lib/finance/projection'
import { todayIso } from '@/lib/today'
import { loadFinanceSnapshot } from '@/services/load-finance-snapshot'

import { cardsMissingCycleSchema } from '../cards/card-schema'

const dashboardSchema = z.object({
  today: z.string(),
  balanceCents: z.number().int(),
  nextIncome: z
    .object({
      recurrenceId: z.string(),
      description: z.string(),
      date: z.string(),
      amountCents: z.number().int(),
    })
    .nullable(),
  windowEnd: z.string(),
  days: z.number().int(),
  noIncomeConfigured: z.boolean(),
  payables: z.array(
    z.object({
      kind: z.enum(['BILL', 'RECURRENCE']),
      refId: z.string(),
      description: z.string(),
      dueDate: z.string(),
      amountCents: z.number().int(),
    }),
  ),
  payableTotalCents: z.number().int(),
  availableCents: z.number().int(),
  perDayCents: z.number().int(),
  cardsMissingCycle: cardsMissingCycleSchema,
})

export async function getDashboard(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/dashboard',
      {
        schema: {
          tags: ['Dashboard'],
          summary: 'How much can be spent until the next income.',
          operationId: 'getDashboard',
          security: [{ bearerAuth: [] }],
          response: { 200: dashboardSchema },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const today = todayIso()
        const { accounts, cardBills, cardsMissingCycle, recurrences, transactions } =
          await loadFinanceSnapshot(userId, today)

        const cardNames = Object.fromEntries(
          accounts.filter((a) => a.type === 'CREDIT').map((a) => [a.id, a.name]),
        )
        const projection = computeProjection({
          today,
          accounts,
          recurrences,
          transactions,
          cardBills,
          cardNames,
        })
        return reply.send({ ...projection, cardsMissingCycle })
      },
    )
}
