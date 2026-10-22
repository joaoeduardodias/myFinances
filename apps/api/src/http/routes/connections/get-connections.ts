import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { connectionSchema, connectionSelect } from './connection-schema'

export async function getConnections(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/connections',
      {
        schema: {
          tags: ['Connections'],
          summary: 'List the connections of the authenticated user.',
          operationId: 'getConnections',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ connections: z.array(connectionSchema) }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const connections = await prisma.connection.findMany({
          select: connectionSelect,
          where: { userId },
          orderBy: { createdAt: 'asc' },
        })
        return reply.send({ connections })
      },
    )
}
