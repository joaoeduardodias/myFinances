import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { CATEGORIES } from '@/lib/finance/categories'

export async function getCategories(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/categories',
      {
        schema: {
          tags: ['Categories'],
          summary: 'List the available transaction categories.',
          operationId: 'getCategories',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ categories: z.array(z.string()) }) },
        },
      },
      async (request, reply) => {
        await request.getCurrentUserId()
        return reply.send({ categories: [...CATEGORIES] })
      },
    )
}
