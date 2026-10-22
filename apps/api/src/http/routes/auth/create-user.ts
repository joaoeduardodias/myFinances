import { hash } from 'bcryptjs'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { prisma } from '@/lib/prisma'
import { emailSchema } from '@/utils/email'

import { signUpRateLimit } from '../../middlewares/rate-limit'
import { ConflictError } from '../_errors/conflict-error'
import { prismaUserSessionStore } from './prisma-user-session-store'
import { setSessionCookie } from './session-cookie'
import { createUserSessionService } from './user-session-service'

export async function createUser(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/users',
    {
      config: signUpRateLimit,
      schema: {
        tags: ['Auth'],
        summary: 'Create user.',
        operationId: 'createUser',
        body: z.object({
          name: z.string().min(1, 'Name is required'),
          email: emailSchema,
          password: z
            .string()
            .min(8, 'Password must be at least 8 characters long'),
        }),
        response: {
          201: z.object({ token: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { name, email, password } = request.body
      const userWithSameEmail = await prisma.user.findUnique({
        where: { email },
      })

      if (userWithSameEmail) {
        throw new ConflictError('Já existe uma conta com este e-mail.')
      }

      const passwordHash = await hash(password, 12)
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
        },
      })

      const sessionService = createUserSessionService(prismaUserSessionStore)
      const issuedSession = await sessionService.create({ userId: user.id })
      const token = await reply.jwtSign(
        { sub: user.id },
        { sign: { expiresIn: '15m' } },
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
