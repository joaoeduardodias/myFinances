import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { pushEndpointSchema } from './push-endpoint'

export async function subscribePush(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/push/subscriptions',
      {
        schema: {
          tags: ['Push'],
          summary: "Save this browser's push subscription for the current user.",
          operationId: 'subscribePush',
          security: [{ bearerAuth: [] }],
          body: z.object({
            endpoint: pushEndpointSchema,
            keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
          }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { endpoint, keys } = request.body
        // O endpoint é do navegador: outro usuário entrando nele assume a inscrição.
        await prisma.pushSubscription.upsert({
          where: { endpoint },
          create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
          update: { userId, p256dh: keys.p256dh, auth: keys.auth },
        })
        return reply.status(204).send(null)
      },
    )
}
