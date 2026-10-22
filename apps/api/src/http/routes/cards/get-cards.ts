import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { todayIso } from '@/lib/today'
import { loadFinanceSnapshot } from '@/services/load-finance-snapshot'

import { cardAccountSchema, cardBillSchema, cardsMissingCycleSchema } from './card-schema'

export async function getCards(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/cards',
      {
        schema: {
          tags: ['Cards'],
          summary: 'List the credit cards with a billing cycle and their bills.',
          operationId: 'getCards',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              cards: z.array(z.object({ account: cardAccountSchema, bills: z.array(cardBillSchema) })),
              cardsMissingCycle: cardsMissingCycleSchema,
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { accounts, cardBills, cardsMissingCycle } = await loadFinanceSnapshot(userId, todayIso())

        const missing = new Set(cardsMissingCycle.map((c) => c.id))
        const cards = accounts
          .filter((a) => a.type === 'CREDIT' && !missing.has(a.id))
          .map(({ id, name, number, balanceCents, closingDay, dueDay }) => ({
            account: { id, name, number, balanceCents, closingDay, dueDay },
            bills: cardBills.filter((b) => b.accountId === id),
          }))
        return reply.send({ cards, cardsMissingCycle })
      },
    )
}
