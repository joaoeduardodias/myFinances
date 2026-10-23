import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { toDbDate } from '@/lib/db-date'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/prisma/generated/client'

import {
  isoDate,
  serializeTransaction,
  transactionSchema,
  transactionSelect,
} from './transaction-schema'

const PAGE_SIZE = 50

const SORTS = {
  date: (order) => ({ date: order }),
  description: (order) => ({ description: order }),
  account: (order) => ({ account: { name: order } }),
  category: (order) => ({ category: { sort: order, nulls: 'last' } }),
  amount: (order) => ({ amountCents: order }),
} satisfies Record<string, (order: Prisma.SortOrder) => Prisma.TransactionOrderByWithRelationInput>

export async function getTransactions(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/transactions',
      {
        schema: {
          tags: ['Transactions'],
          summary: 'List the non-card transactions of the authenticated user (50 per page).',
          operationId: 'getTransactions',
          security: [{ bearerAuth: [] }],
          querystring: z.object({
            from: isoDate.optional(),
            to: isoDate.optional(),
            accountId: z.uuid().optional(),
            category: z.string().min(1).optional(),
            kind: z.enum(['income', 'expense', 'transfer']).optional(),
            page: z.coerce.number().int().min(1).default(1),
            sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS]).default('date'),
            order: z.enum(['asc', 'desc']).default('desc'),
          }),
          response: {
            200: z.object({
              transactions: z.array(transactionSchema),
              page: z.number().int(),
              totalPages: z.number().int(),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { from, to, accountId, category, kind, page, sort, order } = request.query

        // Lançamentos de cartão ficam na tela de cartões.
        const where: Prisma.TransactionWhereInput = { userId, account: { type: { not: 'CREDIT' } } }
        if (from || to) {
          where.date = { ...(from ? { gte: toDbDate(from) } : {}), ...(to ? { lte: toDbDate(to) } : {}) }
        }
        if (accountId) where.accountId = accountId
        if (category) where.category = category === 'none' ? null : category
        if (kind === 'income') Object.assign(where, { amountCents: { gt: 0 }, isTransfer: false })
        if (kind === 'expense') Object.assign(where, { amountCents: { lt: 0 }, isTransfer: false })
        if (kind === 'transfer') where.isTransfer = true

        const [count, rows] = await Promise.all([
          prisma.transaction.count({ where }),
          prisma.transaction.findMany({
            select: transactionSelect,
            where,
            // Desempate estável para a paginação não repetir nem pular linhas.
            orderBy: [SORTS[sort](order), { date: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
          }),
        ])

        return reply.send({
          transactions: rows.map(serializeTransaction),
          page,
          totalPages: Math.max(1, Math.ceil(count / PAGE_SIZE)),
        })
      },
    )
}
