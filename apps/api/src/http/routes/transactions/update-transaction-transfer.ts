import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'

export async function updateTransactionTransfer(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/transactions/:id/transfer',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Mark or unmark a transaction (and its pair) as a transfer.',
          operationId: 'updateTransactionTransfer',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ isTransfer: z.boolean() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { isTransfer } = request.body

        const tx = await prisma.transaction.findFirst({
          select: { id: true, transferPairId: true },
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')

        // O par pode estar em qualquer direção: este aponta para o outro ou o outro para este.
        const pointingAtTx = await prisma.transaction.findFirst({
          select: { id: true },
          where: { transferPairId: id, userId },
        })
        const ids = [id, tx.transferPairId, pointingAtTx?.id].filter(
          (value): value is string => Boolean(value),
        )

        await prisma.$transaction(async (db) => {
          await db.transaction.updateMany({
            where: { id: { in: ids }, userId },
            data: isTransfer
              ? { isTransfer: true, transferLocked: true }
              : { isTransfer: false, transferLocked: true, transferPairId: null },
          })
        })

        return reply.status(204).send(null)
      },
    )
}
