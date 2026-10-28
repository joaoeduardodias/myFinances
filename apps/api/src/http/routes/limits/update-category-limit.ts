import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'

import { BadRequestError } from '../_errors/bad-request-error'

export async function updateCategoryLimit(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .put(
      '/category-limits/:category',
      {
        schema: {
          tags: ['Limits'],
          summary: 'Set (or keep, or accept the proposal of) the monthly limit of a category.',
          operationId: 'updateCategoryLimit',
          security: [{ bearerAuth: [] }],
          params: z.object({ category: z.string() }),
          body: z.object({ limitCents: z.number().int().min(1).max(100_000_000) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { limitCents } = request.body

        const category = LIMIT_CATEGORIES.find((c) => c === request.params.category)
        if (!category) throw new BadRequestError('Essa categoria não aceita limite.')

        const reviewedMonth = todayIso().slice(0, 7)
        await prisma.categoryLimit.upsert({
          where: { userId_category: { userId, category } },
          create: { userId, category, status: 'ACTIVE', limitCents, reviewedMonth },
          update: { status: 'ACTIVE', limitCents, reviewedMonth },
        })
        return reply.status(204).send(null)
      },
    )
}
