import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { loadAdvisorChat } from '@/services/advisor-chat'
import { loadGoalsWithProgress } from '@/services/advisor-goals'
import { ADVISOR_DAILY_CALLS } from '@/services/advisor-quota'

import { goalMonthSchema, goalTargetSchema } from './goal-schema'

export async function getAdvisor(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/advisor',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'The stored advisor summary, the chat of the last days and whether questions are available today.',
          operationId: 'getAdvisor',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              summary: z.object({ day: z.string(), points: z.array(z.string()) }).nullable(),
              questionsAvailable: z.boolean(),
              messages: z.array(
                z.object({
                  role: z.enum(['USER', 'ASSISTANT']),
                  text: z.string(),
                  proposals: z.array(goalTargetSchema).nullable(),
                }),
              ),
              goals: z.array(
                z.object({
                  id: z.string(),
                  target: goalTargetSchema,
                  startMonth: z.string(),
                  months: z.array(goalMonthSchema),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const today = todayIso()
        const [summary, usage, messages, goals] = await Promise.all([
          prisma.advisorSummary.findUnique({ where: { userId } }),
          prisma.advisorUsage.findUnique({ where: { day: today } }),
          loadAdvisorChat(userId),
          loadGoalsWithProgress(userId, today),
        ])
        return reply.send({
          summary: summary ? { day: summary.day, points: summary.points } : null,
          questionsAvailable: (usage?.calls ?? 0) < ADVISOR_DAILY_CALLS,
          // Json do banco: a resposta valida o formato das propostas.
          messages: messages.map((m) => ({ ...m, proposals: m.proposals as never })),
          goals,
        })
      },
    )
}
