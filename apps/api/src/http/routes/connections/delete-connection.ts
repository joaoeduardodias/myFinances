import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { removeTransactions } from '@/services/remove-transactions'

import { NotFoundError } from '../_errors/not-found-error'

export async function deleteConnection(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/connections/:id',
      {
        schema: {
          tags: ['Connections'],
          summary: 'Delete a connection with its accounts and transactions.',
          operationId: 'deleteConnection',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const connection = await prisma.connection.findFirst({
          select: { id: true },
          where: { id, userId },
        })
        if (!connection) throw new NotFoundError('Conexão não encontrada.')

        // A cascata só desvincularia o crédito que um saque gerou na Carteira;
        // órfão, ele duplica quando a conexão volta e o saque gera outro.
        await removeTransactions({ userId, account: { connectionId: id } })
        // Contas e o resto saem em cascata. A Pluggy não é tocada.
        await prisma.connection.delete({ where: { id } })
        return reply.status(204).send(null)
      },
    )
}
