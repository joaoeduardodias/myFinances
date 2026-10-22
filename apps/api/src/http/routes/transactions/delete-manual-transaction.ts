import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { recomputeWalletBalance } from '@/services/wallet'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'

export async function deleteManualTransaction(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/transactions/:id',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Delete a manual transaction.',
          operationId: 'deleteManualTransaction',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const tx = await prisma.transaction.findFirst({
          select: { id: true, source: true, accountId: true },
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')
        if (tx.source !== 'MANUAL') {
          throw new BadRequestError('Só é possível apagar lançamentos manuais.')
        }

        await prisma.transaction.delete({ where: { id } })
        await recomputeWalletBalance(tx.accountId)

        return reply.status(204).send(null)
      },
    )
}
