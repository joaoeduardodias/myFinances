import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'

export async function updateTransactionNecessity(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/transactions/:id/necessity',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Mark a debit as essential or avoidable (null clears the mark).',
          operationId: 'updateTransactionNecessity',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ necessity: z.enum(['ESSENTIAL', 'AVOIDABLE', 'EMERGENCY']).nullable() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { necessity } = request.body

        const tx = await prisma.transaction.findFirst({
          select: { id: true, amountCents: true, isTransfer: true },
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')
        if (tx.amountCents >= 0 || tx.isTransfer) {
          throw new BadRequestError('Só gastos (débitos que não são transferência) têm essa marca.')
        }

        await prisma.transaction.update({ where: { id }, data: { necessity } })
        return reply.status(204).send(null)
      },
    )
}
