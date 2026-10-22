import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'

export async function dismissRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/recurrences/:id/dismiss',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Dismiss a recurrence; it is never suggested again.',
          operationId: 'dismissRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const recurrence = await prisma.recurrence.findFirst({
          select: { id: true },
          where: { id, userId },
        })
        if (!recurrence) throw new NotFoundError('Recorrência não encontrada.')

        // A linha fica: é ela que impede a detecção de sugerir o mesmo grupo de novo.
        await prisma.recurrence.update({ where: { id }, data: { status: 'DISMISSED' } })
        return reply.status(204).send(null)
      },
    )
}
