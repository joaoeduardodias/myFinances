import { compare } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { emailSchema } from '@/utils/email'

import { loginRateLimit } from '../../middlewares/rate-limit'
import { BadRequestError } from '../_errors/bad-request-error'
import { prismaUserSessionStore } from './prisma-user-session-store'
import { setSessionCookie } from './session-cookie'
import { createUserSessionService } from './user-session-service'

export async function authenticateWithPassword(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/sessions/password',
    {
      config: loginRateLimit,
      schema: {
        tags: ['Auth'],
        summary: 'Authenticate with e-mail & password.',
        operationId: 'authenticateWithPassword',
        body: z.object({
          email: emailSchema,
          // Sem mínimo de tamanho: a regra de tamanho é de quem *define* a
          // senha. Exigi-la aqui trancaria para fora quem já tem senha curta,
          // e recusaria antes do `compare` — o que também é um oráculo de
          // qual formato de senha a conta usa.
          password: z.string().min(1, 'Password is required'),
        }),
        response: {
          201: z.object({
            token: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body
      const userFromEmail = await prisma.user.findUnique({
        where: {
          email,
        },
      })
      if (!userFromEmail) {
        throw new BadRequestError('E-mail ou senha incorretos.')
      }
      const isPasswordValid = await compare(
        password,
        userFromEmail.passwordHash,
      )
      if (!isPasswordValid) {
        throw new BadRequestError('E-mail ou senha incorretos.')
      }

      const sessionService = createUserSessionService(prismaUserSessionStore)
      const issuedSession = await sessionService.create({
        userId: userFromEmail.id,
      })
      const token = await reply.jwtSign(
        {
          sub: userFromEmail.id,
        },
        {
          sign: {
            expiresIn: '15m',
          },
        },
      )

      setSessionCookie(
        reply,
        issuedSession.refreshToken,
        issuedSession.session.expiresAt,
      )
      return reply.status(201).send({ token })
    },
  )
}
