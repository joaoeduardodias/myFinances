import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { CATEGORIES } from '@/lib/finance/categories'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import { identicalTxSelect, identicalWhere } from './identical-transactions'

export async function updateTransactionCategory(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/transactions/:id/category',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Set and lock a transaction category; with applyToSimilar, the identical ones too.',
          operationId: 'updateTransactionCategory',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ category: z.enum(CATEGORIES), applyToSimilar: z.boolean().default(false) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { category, applyToSimilar } = request.body

        const tx = await prisma.transaction.findFirst({
          select: identicalTxSelect,
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')

        const identical = applyToSimilar ? identicalWhere(userId, tx) : null
        await prisma.transaction.updateMany({
          where: identical ? { OR: [{ id }, identical] } : { id },
          data: { category, categoryLocked: true },
        })

        return reply.status(204).send(null)
      },
    )
}
