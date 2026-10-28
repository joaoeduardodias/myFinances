import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import {
  closedMonths,
  LIMIT_CATEGORIES,
  monthlyCategorySpend,
  needsRevision,
  PROPOSAL_MONTHS,
  proposeLimit,
  REVISION_MONTHS,
} from '@/lib/finance/category-limits'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { loadAnalysisInput } from '@/services/load-analysis'

export async function getCategoryLimits(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/category-limits',
      {
        schema: {
          tags: ['Limits'],
          summary: 'Monthly limit per category, with the proposal (new) or revision (active) when there is one.',
          operationId: 'getCategoryLimits',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              month: z.string(),
              limits: z.array(
                z.object({
                  category: z.string(),
                  status: z.enum(['NEW', 'ACTIVE', 'DECLINED']),
                  limitCents: z.number().int().nullable(),
                  proposedCents: z.number().int().nullable(),
                  spentCents: z.number().int(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const today = todayIso()
        const month = today.slice(0, 7)

        const [input, rows] = await Promise.all([
          loadAnalysisInput(userId, today),
          prisma.categoryLimit.findMany({ where: { userId } }),
        ])
        const spend = monthlyCategorySpend(input.transactions, input.overrides)
        const history = (category: string, count: number) =>
          closedMonths(today, count, input.firstDate).map((m) => spend.get(m)?.get(category) ?? 0)
        const byCategory = new Map(rows.map((r) => [r.category, r]))

        const limits = LIMIT_CATEGORIES.map((category) => {
          // Estorno sem compra no mês deixaria o gasto negativo.
          const spentCents = Math.max(0, spend.get(month)?.get(category) ?? 0)
          const row = byCategory.get(category)

          if (!row) {
            return {
              category,
              status: 'NEW' as const,
              limitCents: null,
              proposedCents: proposeLimit(history(category, PROPOSAL_MONTHS)),
              spentCents,
            }
          }
          if (row.status === 'DECLINED' || row.limitCents === null) {
            return { category, status: 'DECLINED' as const, limitCents: null, proposedCents: null, spentCents }
          }

          let proposedCents: number | null = null
          // Só contam meses em que o limite já valia (reviewedMonth vem de todo PUT).
          const since = row.reviewedMonth
          const revisionHistory = closedMonths(today, REVISION_MONTHS, input.firstDate)
            .filter((m) => !since || m >= since)
            .map((m) => spend.get(m)?.get(category) ?? 0)
          if (row.reviewedMonth !== month && needsRevision(row.limitCents, revisionHistory)) {
            const proposal = proposeLimit(history(category, PROPOSAL_MONTHS))
            if (proposal !== null && proposal !== row.limitCents) proposedCents = proposal
          }
          return { category, status: 'ACTIVE' as const, limitCents: row.limitCents, proposedCents, spentCents }
        })

        return reply.send({ month, limits })
      },
    )
}
