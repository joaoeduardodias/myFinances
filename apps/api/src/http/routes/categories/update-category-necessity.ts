import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { CATEGORIES, isNecessityCategory } from '@/lib/finance/categories'
import { prisma } from '@/lib/prisma'

import { BadRequestError } from '../_errors/bad-request-error'
import { defaultNecessity } from './get-category-necessities'

export async function updateCategoryNecessity(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .put(
      '/category-necessities/:category',
      {
        schema: {
          tags: ['Categories'],
          summary: 'Override the essential/avoidable default of a category (same as default clears the override).',
          operationId: 'updateCategoryNecessity',
          security: [{ bearerAuth: [] }],
          params: z.object({ category: z.string() }),
          body: z.object({ necessity: z.enum(['ESSENTIAL', 'AVOIDABLE']) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { category } = request.params
        const { necessity } = request.body

        const known = CATEGORIES.find((c) => c === category)
        if (!known || !isNecessityCategory(known)) {
          throw new BadRequestError('Essa categoria não entra na divisão essencial/evitável.')
        }

        if (necessity === defaultNecessity(known)) {
          await prisma.categoryNecessity.deleteMany({ where: { userId, category: known } })
        } else {
          await prisma.categoryNecessity.upsert({
            where: { userId_category: { userId, category: known } },
            create: { userId, category: known, necessity },
            update: { necessity },
          })
        }
        return reply.status(204).send(null)
      },
    )
}
