import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import { recurrenceStatus } from '../recurrences/recurrence-schema'
import { identicalTxSelect, identicalWhere } from './identical-transactions'
import { canBeRecurrence, findTransactionRecurrence, recurrenceTxSelect } from './transaction-recurrence'

export async function getTransactionSimilar(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/transactions/:id/similar',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'How many other transactions are identical (bank text, amount, account), and the recurrence this one belongs to.',
          operationId: 'getTransactionSimilar',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: {
            200: z.object({
              similar: z.number().int(),
              canSaveRecurrence: z.boolean(),
              recurrenceStatus: recurrenceStatus.nullable(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const tx = await prisma.transaction.findFirst({
          select: { ...recurrenceTxSelect, ...identicalTxSelect },
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')

        // As mesmas que os PATCH de descrição e categoria com `applyToSimilar` alcançam.
        const where = identicalWhere(userId, tx)
        const similar = where ? await prisma.transaction.count({ where }) : 0
        const canSaveRecurrence = canBeRecurrence(tx)
        const { recurrence } = canSaveRecurrence ? await findTransactionRecurrence(userId, tx) : { recurrence: null }

        return reply.send({ similar, canSaveRecurrence, recurrenceStatus: recurrence?.status ?? null })
      },
    )
}
