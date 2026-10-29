import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { runExclusive } from '@/services/user-queue'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'
import { identicalTxSelect, identicalWhere } from './identical-transactions'

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
          description:
            'With applyToSimilar, the identical Pluggy transactions (bank text, amount, account) get it too.',
          operationId: 'updateTransactionDescription',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({
            description: z.string().trim().max(200),
            applyToSimilar: z.boolean().default(false),
          }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { description, applyToSimilar } = request.body

        await runExclusive(userId, async () => {
          const tx = await prisma.transaction.findFirst({
            select: { ...identicalTxSelect, source: true, description: true, originalDescription: true },
            where: { id, userId },
          })
          if (!tx) throw new NotFoundError('Transação não encontrada.')
          if (!description && !tx.originalDescription && !applyToSimilar) {
            throw new BadRequestError('A descrição não pode ficar vazia.')
          }

          // Nunca mexe em descriptionKey: recorrentes e categoria seguem o texto do banco.
          await prisma.$transaction(async (db) => {
            const identical = applyToSimilar ? identicalWhere(userId, tx) : null
            const others = identical
              ? await db.transaction.findMany({
                  select: { id: true, source: true, description: true, originalDescription: true },
                  where: identical,
                })
              : []

            for (const t of [tx, ...others]) {
              if (t.source === 'MANUAL') {
                if (description) await db.transaction.update({ where: { id: t.id }, data: { description } })
              } else if (description) {
                await db.transaction.update({
                  where: { id: t.id },
                  data: {
                    description,
                    descriptionLocked: true,
                    originalDescription: t.originalDescription ?? t.description,
                  },
                })
              } else if (t.originalDescription) {
                await db.transaction.update({
                  where: { id: t.id },
                  data: { description: t.originalDescription, descriptionLocked: false, originalDescription: null },
                })
              }
            }
          })
        })
        return reply.status(204).send(null)
      },
    )
}
