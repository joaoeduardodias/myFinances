import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { pushPublicKey } from '@/lib/push'

export async function getPushPublicKey(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/push/public-key',
      {
        schema: {
          tags: ['Push'],
          summary: 'VAPID public key for browser push; null when push is off.',
          operationId: 'getPushPublicKey',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ publicKey: z.string().nullable() }) },
        },
      },
      async (request, reply) => {
        await request.getCurrentUserId()
        return reply.send({ publicKey: pushPublicKey })
      },
    )
}
