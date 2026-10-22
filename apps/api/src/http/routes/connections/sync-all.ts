import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { syncConnection } from '@/services/sync-connection'

/** Conexão sincronizada há mais que isso é refeita ao abrir o app. */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000

export async function syncAll(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/sync',
      {
        schema: {
          tags: ['Connections'],
          summary: 'Sync the stale connections of the authenticated user.',
          operationId: 'syncAll',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            force: z
              .enum(['true', 'false'])
              .optional()
              .transform((value) => value === 'true'),
          }),
          response: { 200: z.object({ synced: z.number().int() }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { force } = request.query

        const connections = await prisma.connection.findMany({
          select: { id: true },
          where: force
            ? { userId }
            : {
                userId,
                OR: [
                  { lastSyncedAt: null },
                  { lastSyncedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
                ],
              },
          orderBy: { createdAt: 'asc' },
        })

        // Uma de cada vez; a falha de uma (já gravada em `lastError`) não
        // impede as outras.
        let synced = 0
        for (const { id } of connections) {
          try {
            await syncConnection(id)
            synced++
          } catch {
            // registrado em lastError por syncConnection
          }
        }
        return reply.send({ synced })
      },
    )
}
