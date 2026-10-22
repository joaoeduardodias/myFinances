import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { ensureWalletAccount } from '@/services/wallet'

export async function getAccounts(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/accounts',
      {
        schema: {
          tags: ['Accounts'],
          summary: 'List the accounts of the authenticated user, wallet included.',
          operationId: 'getAccounts',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              accounts: z.array(
                z.object({
                  id: z.uuid(),
                  type: z.string(),
                  name: z.string(),
                  number: z.string().nullable(),
                  balanceCents: z.number().int(),
                  closingDay: z.number().int().nullable(),
                  dueDay: z.number().int().nullable(),
                  connectorName: z.string().nullable(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        await ensureWalletAccount(userId)

        const rows = await prisma.account.findMany({
          select: {
            id: true,
            type: true,
            name: true,
            number: true,
            balanceCents: true,
            closingDay: true,
            dueDay: true,
            connection: { select: { connectorName: true } },
          },
          where: { userId },
          orderBy: { name: 'asc' },
        })
        const accounts = rows.map(({ connection, ...account }) => ({
          ...account,
          connectorName: connection?.connectorName ?? null,
        }))
        return reply.send({ accounts })
      },
    )
}
