import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { runExclusive } from '@/services/user-queue'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'
import { canBeRecurrence, findTransactionRecurrence, recurrenceTxSelect } from './transaction-recurrence'

export async function saveTransactionRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/transactions/:id/recurrence',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Confirm the recurrence of this transaction, creating it from the transaction when missing.',
          operationId: 'saveTransactionRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        await runExclusive(userId, async () => {
          const tx = await prisma.transaction.findFirst({ select: recurrenceTxSelect, where: { id, userId } })
          if (!tx) throw new NotFoundError('Transação não encontrada.')
          if (!canBeRecurrence(tx)) throw new BadRequestError('Esta transação não pode virar recorrente.')

          // Pedido explícito: vale até sobre um recorrente descartado.
          const { day, recurrence } = await findTransactionRecurrence(userId, tx)
          if (recurrence) {
            await prisma.recurrence.update({
              where: { id: recurrence.id },
              data: { status: 'CONFIRMED', description: tx.description },
            })
            return
          }
          await prisma.recurrence.create({
            data: {
              userId,
              accountId: tx.accountId,
              description: tx.description,
              descriptionKey: tx.descriptionKey,
              direction: tx.amountCents > 0 ? 'IN' : 'OUT',
              expectedAmountCents: Math.abs(tx.amountCents),
              ...day,
              status: 'CONFIRMED',
            },
          })
        })
        return reply.status(204).send(null)
      },
    )
}
