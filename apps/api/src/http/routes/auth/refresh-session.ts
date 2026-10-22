import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { UnauthorizedError } from '../_errors/unauthorized-error'
import { prismaUserSessionStore } from './prisma-user-session-store'
import {
  assertTrustedOrigin,
  readSessionCookie,
  setSessionCookie,
} from './session-cookie'
import {
  createUserSessionService,
  UserSessionError,
} from './user-session-service'

export async function refreshSession(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Rotate the user session kept in the refresh token cookie.',
        operationId: 'refreshSession',
        response: {
          201: z.object({ token: z.string() }),
        },
      },
    },
    async (request, reply) => {
      assertTrustedOrigin(request)
      const refreshToken = readSessionCookie(request)
      if (!refreshToken) {
        throw new UnauthorizedError('Sessão expirada. Entre novamente.')
      }
      try {
        const service = createUserSessionService(prismaUserSessionStore)
        const rotated = await service.refresh(refreshToken)
        const token = await reply.jwtSign(
          { sub: rotated.session.userId },
          { sign: { expiresIn: '15m' } },
        )
        setSessionCookie(
          reply,
          rotated.refreshToken,
          rotated.session.expiresAt,
        )
        return reply.status(201).send({ token })
      } catch (error) {
        if (error instanceof UserSessionError) {
          // Sem apagar o cookie: com duas abas renovando juntas, a que perde
          // a corrida cai aqui, e apagar levaria o cookie novo da outra.
          throw new UnauthorizedError(error.message)
        }
        throw error
      }
    },
  )
}
