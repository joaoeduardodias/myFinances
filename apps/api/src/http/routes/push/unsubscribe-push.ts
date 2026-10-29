import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { pushEndpointSchema } from './push-endpoint'

export async function unsubscribePush(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/push/subscriptions',
      {
        schema: {
          tags: ['Push'],
          summary: "Remove this browser's push subscription.",
          operationId: 'unsubscribePush',
          security: [{ bearerAuth: [] }],
          body: z.object({ endpoint: pushEndpointSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        await prisma.pushSubscription.deleteMany({ where: { userId, endpoint: request.body.endpoint } })
        return reply.status(204).send(null)
      },
    )
}
