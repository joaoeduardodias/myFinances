import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { todayIso } from '@/lib/today'
import { acceptGoal } from '@/services/advisor-goals'

import { goalTargetSchema } from './goal-schema'

export async function acceptAdvisorGoal(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/advisor/goals',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'Accepts a goal proposed by the advisor, replacing the active one with the same target.',
          operationId: 'acceptAdvisorGoal',
          security: [{ bearerAuth: [] }],
          body: goalTargetSchema,
          response: { 201: z.object({ id: z.string() }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const id = await acceptGoal(userId, request.body, todayIso())
        return reply.status(201).send({ id })
      },
    )
}
