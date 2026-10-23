import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { pluggy } from '@/lib/pluggy/client'

/** Id do conector MeuPluggy na Pluggy (GET /connectors?name=MeuPluggy). */
export const MEU_PLUGGY_CONNECTOR_ID = 200

export async function createConnectToken(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/connections/connect-token',
      {
        schema: {
          tags: ['Connections'],
          summary: 'Create a short-lived Pluggy Connect token.',
          operationId: 'createConnectToken',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({ accessToken: z.string(), connectorId: z.number() }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const accessToken = await pluggy.createConnectToken(userId)
        return reply.send({ accessToken, connectorId: MEU_PLUGGY_CONNECTOR_ID })
      },
    )
}
