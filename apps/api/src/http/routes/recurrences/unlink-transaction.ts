import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import { findOwnedRecurrence } from './owned-recurrence'

export async function unlinkTransaction(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/recurrences/:id/links/:transactionId',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Unlink a transaction from this recurrence.',
          operationId: 'unlinkRecurrenceTransaction',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid(), transactionId: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id, transactionId } = request.params

        const recurrence = await findOwnedRecurrence(userId, id)
        const { count } = recurrence.payrollDeduction
          ? await prisma.recurrencePayrollLink.deleteMany({ where: { recurrenceId: id, transactionId } })
          : await prisma.transaction.updateMany({
              where: { id: transactionId, userId, recurrenceId: id },
              data: { recurrenceId: null },
            })
        if (count === 0) throw new NotFoundError('Transação não encontrada neste recorrente.')
        // Desvinculada à mão não volta no vínculo automático (salário ou irmãs).
        await prisma.recurrenceLinkDismissal.createMany({
          data: [{ recurrenceId: id, transactionId }],
          skipDuplicates: true,
        })
        return reply.status(204).send(null)
      },
    )
}
