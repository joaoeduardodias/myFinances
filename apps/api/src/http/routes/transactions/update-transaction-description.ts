import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { runExclusive } from '@/services/user-queue'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'

export async function updateTransactionDescription(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/transactions/:id/description',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Edit the description (empty restores the bank text on Pluggy transactions).',
          operationId: 'updateTransactionDescription',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({ description: z.string().trim().max(200) }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { description } = request.body

        await runExclusive(userId, async () => {
          const tx = await prisma.transaction.findFirst({
            select: { source: true, description: true, originalDescription: true },
            where: { id, userId },
          })
          if (!tx) throw new NotFoundError('Transação não encontrada.')

          // Nunca mexe em descriptionKey: recorrentes e categoria seguem o texto do banco.
          if (description) {
            await prisma.transaction.update({
              where: { id },
              data:
                tx.source === 'MANUAL'
                  ? { description }
                  : {
                      description,
                      descriptionLocked: true,
                      originalDescription: tx.originalDescription ?? tx.description,
                    },
            })
          } else {
            if (!tx.originalDescription) throw new BadRequestError('A descrição não pode ficar vazia.')
            await prisma.transaction.update({
              where: { id },
              data: { description: tx.originalDescription, descriptionLocked: false, originalDescription: null },
            })
          }
        })
        return reply.status(204).send(null)
      },
    )
}
