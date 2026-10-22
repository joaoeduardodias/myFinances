import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import { cardAccountSchema, cardAccountSelect } from './card-schema'

const cycleDay = (label: string) =>
  z
    .number({ error: `Informe o dia de ${label}.` })
    .int(`O dia de ${label} deve ser um número inteiro.`)
    .min(1, `O dia de ${label} deve ser de 1 a 31.`)
    .max(31, `O dia de ${label} deve ser de 1 a 31.`)

export async function updateCardCycle(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/cards/:accountId',
      {
        schema: {
          tags: ['Cards'],
          summary: 'Set the closing and due days of a credit card.',
          operationId: 'updateCardCycle',
          security: [{ bearerAuth: [] }],
          params: z.object({ accountId: z.uuid() }),
          body: z.strictObject({
            closingDay: cycleDay('fechamento'),
            dueDay: cycleDay('vencimento'),
          }),
          response: { 200: z.object({ account: cardAccountSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { accountId } = request.params
        const { closingDay, dueDay } = request.body

        const card = await prisma.account.findFirst({
          select: { id: true },
          where: { id: accountId, userId, type: 'CREDIT' },
        })
        if (!card) throw new NotFoundError('Cartão não encontrado.')

        const account = await prisma.account.update({
          select: cardAccountSelect,
          where: { id: accountId },
          data: { closingDay, dueDay },
        })
        return reply.send({ account })
      },
    )
}
