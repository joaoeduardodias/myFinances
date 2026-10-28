import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { prisma } from '@/lib/prisma'

import { BadRequestError } from '../_errors/bad-request-error'

export async function declineCategoryLimit(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/category-limits/:category',
      {
        schema: {
          tags: ['Limits'],
          summary: 'Decline the limit of a category (no more proposals for it).',
          operationId: 'declineCategoryLimit',
          security: [{ bearerAuth: [] }],
          params: z.object({ category: z.string() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()

        const category = LIMIT_CATEGORIES.find((c) => c === request.params.category)
        if (!category) throw new BadRequestError('Essa categoria não aceita limite.')

        await prisma.categoryLimit.upsert({
          where: { userId_category: { userId, category } },
          create: { userId, category, status: 'DECLINED', limitCents: null },
          update: { status: 'DECLINED', limitCents: null },
        })
        return reply.status(204).send(null)
      },
    )
}
