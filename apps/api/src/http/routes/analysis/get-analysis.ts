import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { annualAnalysis } from '@/lib/finance/annual-analysis'
import { loadAnalysisInput } from '@/services/load-analysis'

import { assertMonthInWindow, monthQuerySchema } from './month-query'

const cents = z.number().int()
const group = z.enum(['essential', 'avoidable', 'emergency', 'debt', 'unclassified'])
const totalsSchema = z.object({
  incomeCents: cents,
  essentialCents: cents,
  avoidableCents: cents,
  emergencyCents: cents,
  debtCents: cents,
  unclassifiedCents: cents,
  investedCents: cents,
})

export const expenseSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  amountCents: cents,
  category: z.string().nullable(),
  necessity: z.enum(['ESSENTIAL', 'AVOIDABLE', 'EMERGENCY']).nullable(),
  accountName: z.string(),
  group,
})

const analysisSchema = z.object({
  from: z.string(),
  to: z.string(),
  month: z.string().nullable(),
  months: z.array(totalsSchema.extend({ month: z.string() })),
  totals: totalsSchema,
  categories: z.array(
    z.object({
      category: z.string().nullable(),
      group,
      totalCents: cents,
      averageCents: cents,
      count: cents,
    }),
  ),
  topExpenses: z.array(expenseSchema),
  topAvoidable: z.array(expenseSchema),
  uncategorized: z.object({ count: cents, totalCents: cents }),
})

export async function getAnalysis(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/analysis',
      {
        schema: {
          tags: ['Analysis'],
          summary: 'Income, essential/avoidable spending and investments over the last 12 months, optionally cut to one month.',
          operationId: 'getAnalysis',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ month: monthQuerySchema.optional() }),
          response: { 200: analysisSchema },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { month } = request.query
        const { today, ...input } = await loadAnalysisInput(userId)
        assertMonthInWindow(month, today)
        return reply.send(annualAnalysis({ today, month, ...input }))
      },
    )
}
