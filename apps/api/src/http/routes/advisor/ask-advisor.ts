import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { todayIso } from '@/lib/today'
import { askAdvisor as ask } from '@/services/ask-advisor'

export async function askAdvisor(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/advisor/questions',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'Asks the advisor a question; answer is null when unavailable.',
          operationId: 'askAdvisor',
          security: [{ bearerAuth: [] }],
          body: z.object({ question: z.string().trim().min(1).max(300) }),
          response: { 200: z.object({ answer: z.string().nullable() }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const result = await ask(userId, request.body.question, todayIso())
        return reply.send({ answer: result.kind === 'answer' ? result.text : null })
      },
    )
}
