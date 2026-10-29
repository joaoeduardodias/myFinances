import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { endGoal } from '@/services/advisor-goals'

import { NotFoundError } from '../_errors/not-found-error'

export async function endAdvisorGoal(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/advisor/goals/:id',
      {
        schema: {
          tags: ['Advisor'],
          summary: 'Ends an active advisor goal.',
          operationId: 'endAdvisorGoal',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.string().uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        if (!(await endGoal(userId, request.params.id))) throw new NotFoundError('Meta não encontrada.')
        return reply.status(204).send(null)
      },
    )
}
