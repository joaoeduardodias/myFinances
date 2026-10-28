import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

export async function readNotifications(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/notifications/read',
      {
        schema: {
          tags: ['Notifications'],
          summary: 'Mark all notifications as read.',
          operationId: 'readNotifications',
          security: [{ bearerAuth: [] }],
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })
        return reply.status(204).send(null)
      },
    )
}
