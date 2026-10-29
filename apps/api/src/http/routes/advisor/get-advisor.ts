import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { ADVISOR_DAILY_CALLS } from '@/services/advisor-quota'

export async function getAdvisor(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/advisor',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'The stored advisor summary and whether questions are available today.',
          operationId: 'getAdvisor',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              summary: z.object({ day: z.string(), points: z.array(z.string()) }).nullable(),
              questionsAvailable: z.boolean(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const [summary, usage] = await Promise.all([
          prisma.advisorSummary.findUnique({ where: { userId } }),
          prisma.advisorUsage.findUnique({ where: { day: todayIso() } }),
        ])
        return reply.send({
          summary: summary ? { day: summary.day, points: summary.points } : null,
          questionsAvailable: (usage?.calls ?? 0) < ADVISOR_DAILY_CALLS,
        })
      },
    )
}
