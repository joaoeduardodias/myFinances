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
          description:
            'With applyToSimilar, every Pluggy transaction with the same bank text, and the next ones, get the name too; empty undoes it.',
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
            select: { source: true, description: true, originalDescription: true, descriptionKey: true },
            where: { id, userId },
          })
          if (!tx) throw new NotFoundError('Transação não encontrada.')
          if (!description && !tx.originalDescription && !applyToSimilar) {
            throw new BadRequestError('A descrição não pode ficar vazia.')
          }

          // Nunca mexe em descriptionKey: recorrentes e categoria seguem o texto do banco.
          await prisma.$transaction(async (db) => {
            if (tx.source === 'MANUAL') {
              if (description) await db.transaction.update({ where: { id }, data: { description } })
            }

            // Chave vazia (descrição só de dígitos) não identifica o lançamento: só esta muda.
            const key = tx.descriptionKey
            const targets =
              applyToSimilar && key
                ? await db.transaction.findMany({
                    select: { id: true, description: true, originalDescription: true },
                    where: { userId, descriptionKey: key, source: 'PLUGGY' },
                  })
                : tx.source === 'PLUGGY'
                  ? [{ id, description: tx.description, originalDescription: tx.originalDescription }]
                  : []

            for (const t of targets) {
              if (description) {
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

            if (!key) return
            if (description && applyToSimilar) {
              await db.descriptionRule.upsert({
                where: { userId_descriptionKey: { userId, descriptionKey: key } },
                create: { userId, descriptionKey: key, description },
                update: { description },
              })
            } else if (!description) {
              // Voltar ao texto do banco desfaz o nome das próximas também.
              await db.descriptionRule.deleteMany({ where: { userId, descriptionKey: key } })
            }
          })
        })
        return reply.status(204).send(null)
      },
    )
}
