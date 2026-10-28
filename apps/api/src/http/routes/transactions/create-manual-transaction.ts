import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { toDbDate } from '@/lib/db-date'
import { CATEGORIES } from '@/lib/finance/categories'
import { descriptionKey } from '@/lib/finance/description-key'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { checkAlerts } from '@/services/check-alerts'
import { runExclusive } from '@/services/user-queue'
import { ensureWalletAccount, recomputeWalletBalance } from '@/services/wallet'

import {
  isoDate,
  serializeTransaction,
  transactionSchema,
  transactionSelect,
} from './transaction-schema'

export async function createManualTransaction(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/transactions',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'Create a manual transaction in the wallet.',
          operationId: 'createManualTransaction',
          security: [{ bearerAuth: [] }],
          body: z.object({
            date: isoDate,
            description: z.string().trim().min(1).max(200),
            amountCents: z.number().int().refine((v) => v !== 0, 'O valor não pode ser zero.'),
            category: z.enum(CATEGORIES).optional(),
          }),
          response: { 201: z.object({ transaction: transactionSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { date, description, amountCents, category } = request.body

        const wallet = await ensureWalletAccount(userId)
        const transaction = await prisma.transaction.create({
          select: transactionSelect,
          data: {
            userId,
            accountId: wallet.id,
            date: toDbDate(date),
            description,
            descriptionKey: descriptionKey(description),
            amountCents,
            status: 'POSTED',
            source: 'MANUAL',
            ...(category ? { category, categoryLocked: true } : {}),
          },
        })
        await recomputeWalletBalance(wallet.id)
        await runExclusive(userId, () => checkAlerts(userId, todayIso()))

        return reply.status(201).send({ transaction: serializeTransaction(transaction) })
      },
    )
}
