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

export async function createRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/recurrences',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Create a confirmed recurrence manually.',
          operationId: 'createRecurrence',
          security: [{ bearerAuth: [] }],
          body: z.object({
            ...recurrenceFields,
            nonBusinessDayPolicy: recurrenceFields.nonBusinessDayPolicy.default('ANTICIPATE'),
          }),
          response: { 201: z.object({ recurrence: recurrenceSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const body = request.body
        assertDayValue(body.dayRule, body.dayValue)
        const key = descriptionKey(body.description)
        assertDescriptionKey(key)

        const account = await prisma.account.findFirst({
          select: { id: true },
          where: { id: body.accountId, userId },
        })
        if (!account) throw new NotFoundError('Conta não encontrada.')

        const recurrence = await prisma.recurrence.create({
          select: recurrenceSelect,
          data: { ...body, userId, descriptionKey: key, status: 'CONFIRMED' },
        })
        return reply.status(201).send({ recurrence })
      },
    )
}
