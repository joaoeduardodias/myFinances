import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { linkSimilarTransactions } from '@/services/link-similar-transactions'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'
import { findOwnedRecurrence } from './owned-recurrence'

const MAX_LINKS = 100

export async function linkTransactions(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/recurrences/:id/links',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Link transactions to this recurrence (one linked elsewhere moves here) and the look-alikes that follow the same pattern.',
          operationId: 'linkRecurrenceTransactions',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({
            transactionIds: z
              .array(z.uuid())
              .min(1)
              .max(MAX_LINKS)
              .refine((ids) => new Set(ids).size === ids.length, 'Transação repetida.'),
          }),
          response: {
            200: z.object({ linked: z.number().int(), similar: z.number().int() }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { transactionIds } = request.body

        const recurrence = await findOwnedRecurrence(userId, id)
        if (recurrence.kind === 'EXTERNAL') {
          throw new BadRequestError('Recorrente fora da Pluggy não tem transações.')
        }

        const txs = await prisma.transaction.findMany({
          where: { id: { in: transactionIds }, userId },
          select: { id: true, amountCents: true, isTransfer: true },
        })
        if (txs.length !== transactionIds.length) throw new NotFoundError('Transação não encontrada.')
        // Em folha, a parcela é paga com o crédito do salário: o vínculo é com a entrada.
        const linksIncome = recurrence.direction === 'IN' || recurrence.payrollDeduction
        const sign = linksIncome ? 1 : -1
        if (txs.some((t) => t.isTransfer || Math.sign(t.amountCents) !== sign)) {
          throw new BadRequestError(
            linksIncome
              ? 'Só entradas que não são transferência podem ser vinculadas.'
              : 'Só saídas que não são transferência podem ser vinculadas.',
          )
        }

        if (recurrence.payrollDeduction) {
          // À parte: o crédito continua sendo do recorrente do salário.
          await prisma.recurrencePayrollLink.createMany({
            data: transactionIds.map((transactionId) => ({ recurrenceId: id, transactionId })),
            skipDuplicates: true,
          })
          return reply.send({ linked: transactionIds.length, similar: 0 })
        }

        // Uma escrita só: ou todas mudam, ou nenhuma.
        await prisma.transaction.updateMany({ where: { id: { in: transactionIds }, userId }, data: { recurrenceId: id } })
        // As outras parcelas do mesmo padrão (texto do banco ou valor exato) vêm junto.
        const similar = await linkSimilarTransactions(userId, { recurrenceIds: [id] })
        return reply.send({ linked: transactionIds.length, similar })
      },
    )
}
