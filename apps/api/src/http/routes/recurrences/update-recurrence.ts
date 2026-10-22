import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { descriptionKey } from '@/lib/finance/description-key'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import {
  assertDayValue,
  assertDescriptionKey,
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
          body: z
            .object({ ...recurrenceFields, status: z.literal('CONFIRMED') })
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

        const data: typeof body & { descriptionKey?: string } = { ...body }
        if (body.description !== undefined) {
          data.descriptionKey = descriptionKey(body.description)
          assertDescriptionKey(data.descriptionKey)
        }

        if (body.accountId !== undefined) {
          const account = await prisma.account.findFirst({
            select: { id: true },
            where: { id: body.accountId, userId },
          })
          if (!account) throw new NotFoundError('Conta não encontrada.')
        }

        const recurrence = await prisma.recurrence.update({
          select: recurrenceSelect,
          where: { id },
          data,
        })
        return reply.send({ recurrence })
      },
    )
}
