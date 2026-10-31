import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'

export async function deleteRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/recurrences/:id',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Delete a recurrence; its transactions stay, unlinked. Detection may suggest it again.',
          operationId: 'deleteRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const recurrence = await prisma.recurrence.findFirst({ select: { id: true }, where: { id, userId } })
        if (!recurrence) throw new NotFoundError('Recorrência não encontrada.')

        // O vínculo das transações cai pelo `onDelete: SetNull`.
        await prisma.recurrence.delete({ where: { id } })
        return reply.status(204).send(null)
      },
    )
}
