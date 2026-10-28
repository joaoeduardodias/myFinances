import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

export async function getNotifications(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/notifications',
      {
        schema: {
          tags: ['Notifications'],
          summary: 'The 30 most recent notifications and the unread count.',
          operationId: 'getNotifications',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              unreadCount: z.number().int(),
              notifications: z.array(
                z.object({
                  id: z.string(),
                  kind: z.string(),
                  title: z.string(),
                  body: z.string(),
                  createdAt: z.string(),
                  read: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const [rows, unreadCount] = await Promise.all([
          prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
          prisma.notification.count({ where: { userId, readAt: null } }),
        ])
        return reply.send({
          unreadCount,
          notifications: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            createdAt: n.createdAt.toISOString(),
            read: n.readAt !== null,
          })),
        })
      },
    )
}
