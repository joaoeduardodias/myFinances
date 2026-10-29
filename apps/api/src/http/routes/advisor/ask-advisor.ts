import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { todayIso } from '@/lib/today'
import { askInAdvisorChat } from '@/services/advisor-chat'

import { goalTargetSchema } from './goal-schema'

export async function askAdvisor(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/advisor/questions',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'Asks the advisor in the chat; answer is null when unavailable (nothing is stored).',
          operationId: 'askAdvisor',
          security: [{ bearerAuth: [] }],
          body: z.object({ question: z.string().trim().min(1).max(300) }),
          response: {
            200: z.object({ answer: z.string().nullable(), proposals: z.array(goalTargetSchema) }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const result = await askInAdvisorChat(userId, request.body.question, todayIso(), { log: request.log })
        return reply.send(
          result.kind === 'answer'
            ? { answer: result.text, proposals: result.proposals }
            : { answer: null, proposals: [] },
        )
      },
    )
}
