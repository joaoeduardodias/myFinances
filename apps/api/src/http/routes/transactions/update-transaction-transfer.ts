import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { recomputeWalletBalance } from '@/services/wallet'

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
        const ids = [
          ...new Set(
            [id, tx.transferPairId, pointingAtTx?.id].filter((value): value is string => Boolean(value)),
          ),
        ]

        // O crédito que um saque gerou na Carteira só existe por causa do par:
        // desfeito o par, ele sai e o saldo da Carteira volta.
        const walletCredits = isTransfer
          ? []
          : await prisma.transaction.findMany({
              select: { id: true, accountId: true },
              where: { id: { in: ids }, userId, source: 'SYSTEM' },
            })
        const creditIds = new Set(walletCredits.map((credit) => credit.id))
        const remainingIds = ids.filter((value) => !creditIds.has(value))

        await prisma.$transaction(async (db) => {
          if (creditIds.size > 0) {
            await db.transaction.deleteMany({ where: { id: { in: [...creditIds] }, userId } })
          }
          if (remainingIds.length > 0) {
            await db.transaction.updateMany({
              where: { id: { in: remainingIds }, userId },
              data: isTransfer
                ? { isTransfer: true, transferLocked: true }
                : { isTransfer: false, transferLocked: true, transferPairId: null },
            })
          }
        })
        for (const walletId of new Set(walletCredits.map((credit) => credit.accountId))) {
          await recomputeWalletBalance(walletId)
        }

        return reply.status(204).send(null)
      },
    )
}
