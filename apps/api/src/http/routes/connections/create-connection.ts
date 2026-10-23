import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { PluggyNotFoundError, pluggy } from '@/lib/pluggy/client'
import { prisma } from '@/lib/prisma'
import { syncConnection } from '@/services/sync-connection'

import { BadRequestError } from '../_errors/bad-request-error'
import { ConflictError } from '../_errors/conflict-error'
import { connectionSchema, connectionSelect, serializeConnection } from './connection-schema'

export async function createConnection(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/connections',
      {
        schema: {
          tags: ['Connections'],
          summary: 'Create a connection from a Pluggy item.',
          operationId: 'createConnection',
          security: [{ bearerAuth: [] }],
          body: z.object({ itemId: z.uuid() }),
          response: { 201: z.object({ connection: connectionSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { itemId } = request.body

        const item = await pluggy.getItem(itemId).catch((error) => {
          if (error instanceof PluggyNotFoundError) {
            throw new BadRequestError('Item não encontrado na Pluggy')
          }
          throw error
        })

        const existing = await prisma.connection.findUnique({
          where: { pluggyItemId: itemId },
        })
        if (existing) {
          throw new ConflictError('Esta conexão já está cadastrada')
        }

        const created = await prisma.connection.create({
          data: {
            userId,
            pluggyItemId: itemId,
            connectorName: item.connector.name,
            status: item.status,
          },
        })

        // Se a sincronização falhar, `syncConnection` já registrou o motivo em
        // `lastError`; a conexão fica e o usuário pode tentar de novo.
        await syncConnection(created.id).catch(() => {})

        const connection = await prisma.connection.findUniqueOrThrow({
          select: connectionSelect,
          where: { id: created.id },
        })
        return reply.status(201).send({ connection: serializeConnection(connection) })
      },
    )
}
