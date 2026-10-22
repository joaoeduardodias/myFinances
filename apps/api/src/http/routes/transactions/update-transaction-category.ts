import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { CATEGORIES } from '@/lib/finance/categories'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'

export async function updateTransactionCategory(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/transactions/:id/category',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Set a transaction category, lock it and learn a rule for its description.',
          operationId: 'updateTransactionCategory',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ category: z.enum(CATEGORIES) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { category } = request.body

        const tx = await prisma.transaction.findFirst({
          select: { id: true, descriptionKey: true },
          where: { id, userId },
        })
        if (!tx) throw new NotFoundError('Transação não encontrada.')

        await prisma.$transaction(async (db) => {
          await db.transaction.update({
            where: { id },
            data: { category, categoryLocked: true },
          })
          // Chave vazia (descrição só de dígitos) não identifica estabelecimento:
          // trava só esta transação, sem regra nem propagação.
          if (!tx.descriptionKey) return
          await db.categoryRule.upsert({
            where: { userId_descriptionKey: { userId, descriptionKey: tx.descriptionKey } },
            create: { userId, descriptionKey: tx.descriptionKey, category },
            update: { category },
          })
          await db.transaction.updateMany({
            where: { userId, descriptionKey: tx.descriptionKey, categoryLocked: false },
            data: { category },
          })
        })

        return reply.status(204).send(null)
      },
    )
}
