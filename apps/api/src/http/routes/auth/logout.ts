import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { prismaUserSessionStore } from './prisma-user-session-store'
import {
  assertTrustedOrigin,
  clearSessionCookie,
  readSessionCookie,
} from './session-cookie'
import { createUserSessionService } from './user-session-service'

export async function logout(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Revoke the user session kept in the refresh token cookie.',
        operationId: 'logout',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      assertTrustedOrigin(request)
      const refreshToken = readSessionCookie(request)
      if (refreshToken) {
        const service = createUserSessionService(prismaUserSessionStore)
        await service.logout(refreshToken)
      }
      clearSessionCookie(reply)
      return reply.status(204).send(null)
    },
  )
}
