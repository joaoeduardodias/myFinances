import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { classify } from '@/lib/finance/annual-analysis'
import { loadAnalysisInput } from '@/services/load-analysis'

import { expenseSchema } from './get-analysis'
import { assertMonthInWindow, monthQuerySchema } from './month-query'

export async function getAnalysisTransactions(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/analysis/transactions',
      {
        schema: {
          tags: ['Analysis'],
          summary: 'Spending transactions of one category (or "none" for uncategorized) in the analysis window, newest first.',
          operationId: 'getAnalysisTransactions',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ category: z.string().min(1), month: monthQuerySchema.optional() }),
          response: {
            200: z.object({
              transactions: z.array(expenseSchema.extend({ categoryLocked: z.boolean() })),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { category, month } = request.query
        const { today, transactions, overrides } = await loadAnalysisInput(userId)
        assertMonthInWindow(month, today)

        const wanted = category === 'none' ? null : category
        const list = []
        for (const tx of transactions) {
          if (tx.category !== wanted) continue
          if (month && !tx.date.startsWith(month)) continue
          const c = classify(tx, overrides)
          if (c.kind !== 'spend') continue
          const { isTransfer: _t, accountType: _a, ...rest } = tx
          list.push({ ...rest, group: c.group })
        }
        list.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
        return reply.send({ transactions: list })
      },
    )
}
