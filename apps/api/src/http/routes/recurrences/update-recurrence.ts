import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import {
  assertDayValue,
  recurrenceFields,
  recurrenceSchema,
  recurrenceSelect,
} from './recurrence-schema'

export async function updateRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/recurrences/:id',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Edit a recurrence; status CONFIRMED confirms a suggestion.',
          operationId: 'updateRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          // Sem `accountId` nem `direction`, e `description` é só rótulo: conta,
          // `descriptionKey` e sentido são a identidade que impede a detecção de
          // ressuscitar o que foi descartado.
          body: z
            .strictObject({
              description: recurrenceFields.description,
              expectedAmountCents: recurrenceFields.expectedAmountCents,
              dayRule: recurrenceFields.dayRule,
              dayValue: recurrenceFields.dayValue,
              nonBusinessDayPolicy: recurrenceFields.nonBusinessDayPolicy,
              status: z.literal('CONFIRMED'),
            })
            .partial(),
          response: { 200: z.object({ recurrence: recurrenceSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const body = request.body

        const current = await prisma.recurrence.findFirst({
          select: { dayRule: true, dayValue: true },
          where: { id, userId },
        })
        if (!current) throw new NotFoundError('Recorrência não encontrada.')

        // A regra e o dia podem chegar separados; valida o par que vai ficar gravado.
        assertDayValue(body.dayRule ?? current.dayRule, body.dayValue ?? current.dayValue)

        const recurrence = await prisma.recurrence.update({
          select: recurrenceSelect,
          where: { id },
          data: body,
        })
        return reply.send({ recurrence })
      },
    )
}
