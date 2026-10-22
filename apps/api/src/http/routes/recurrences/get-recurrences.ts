import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { recurrenceSchema, recurrenceSelect, recurrenceStatus } from './recurrence-schema'

export async function getRecurrences(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/recurrences',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'List the recurrences of the authenticated user.',
          operationId: 'getRecurrences',
          security: [{ bearerAuth: [] }],
          querystring: z.object({ status: recurrenceStatus.optional() }),
          response: { 200: z.object({ recurrences: z.array(recurrenceSchema) }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { status } = request.query

        const recurrences = await prisma.recurrence.findMany({
          select: recurrenceSelect,
          where: { userId, ...(status ? { status } : {}) },
          orderBy: [{ dayValue: 'asc' }, { description: 'asc' }],
        })
        return reply.send({ recurrences })
      },
    )
}
