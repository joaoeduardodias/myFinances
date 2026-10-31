import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import { findOwnedRecurrence } from './owned-recurrence'

export async function dismissLinkSuggestion(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/recurrences/:id/link-dismissals',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Stop suggesting this transaction for this recurrence ("Não é").',
          operationId: 'dismissRecurrenceLinkSuggestion',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ transactionId: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { transactionId } = request.body

        await findOwnedRecurrence(userId, id)
        const tx = await prisma.transaction.findFirst({ select: { id: true }, where: { id: transactionId, userId } })
        if (!tx) throw new NotFoundError('Transação não encontrada.')

        await prisma.recurrenceLinkDismissal.createMany({
          data: [{ recurrenceId: id, transactionId }],
          skipDuplicates: true,
        })
        return reply.status(204).send(null)
      },
    )
}
