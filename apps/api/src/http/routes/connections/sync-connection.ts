import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { PluggyError } from '@/lib/pluggy/client'
import { friendlyConnectionError, PLUGGY_GENERIC_ERROR_MESSAGE } from '@/lib/pluggy/connection-error'
import { prisma } from '@/lib/prisma'
import { syncConnection } from '@/services/sync-connection'

import { BadGatewayError } from '../_errors/bad-gateway-error'
import { NotFoundError } from '../_errors/not-found-error'

/** Resposta da Pluggy com erro, ou a Pluggy nem respondeu (rede). */
function isPluggyFailure(error: unknown): error is Error {
  return (
    error instanceof PluggyError ||
    (error instanceof TypeError && error.message === 'fetch failed')
  )
}

export async function syncConnectionRoute(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/connections/:id/sync',
      {
        schema: {
          tags: ['Connections'],
          summary: 'Sync one connection now.',
          operationId: 'syncConnection',
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

        try {
          await syncConnection(id)
        } catch (error) {
          if (isPluggyFailure(error)) {
            throw new BadGatewayError(
              friendlyConnectionError(error.message) ?? PLUGGY_GENERIC_ERROR_MESSAGE,
            )
          }
          throw error
        }
        return reply.status(204).send(null)
      },
    )
}
