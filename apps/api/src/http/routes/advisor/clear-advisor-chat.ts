import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

export async function clearAdvisorChat(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/advisor/messages',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'Starts a new advisor conversation, deleting the current one.',
          operationId: 'clearAdvisorChat',
          security: [{ bearerAuth: [] }],
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        await prisma.advisorMessage.deleteMany({ where: { userId } })
        return reply.status(204).send(null)
      },
    )
}
