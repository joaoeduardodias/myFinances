import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { CATEGORIES, DEFAULT_GROUP, isNecessityCategory } from '@/lib/finance/categories'
import { prisma } from '@/lib/prisma'

type NecessityValue = 'ESSENTIAL' | 'AVOIDABLE'

/** Padrão essencial/evitável de uma categoria que entra na divisão. */
export function defaultNecessity(category: (typeof CATEGORIES)[number]): NecessityValue {
  return DEFAULT_GROUP[category] === 'essential' ? 'ESSENTIAL' : 'AVOIDABLE'
}

/** Trocas do usuário sobre o padrão, por categoria. */
export async function loadNecessityOverrides(userId: string): Promise<Map<string, NecessityValue>> {
  const rows = await prisma.categoryNecessity.findMany({
    select: { category: true, necessity: true },
    where: { userId },
  })
  // O enum do banco tem EMERGENCY (só de transação); padrão de categoria nunca o grava.
  return new Map(
    rows.flatMap((r): [string, NecessityValue][] => (r.necessity === 'EMERGENCY' ? [] : [[r.category, r.necessity]])),
  )
}

export async function getCategoryNecessities(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/category-necessities',
      {
        schema: {
          tags: ['Categories'],
          summary: 'List the essential/avoidable mark of each category, default merged with the user override.',
          operationId: 'getCategoryNecessities',
          security: [{ bearerAuth: [] }],
          response: {
            200: z.object({
              categories: z.array(
                z.object({
                  category: z.string(),
                  necessity: z.enum(['ESSENTIAL', 'AVOIDABLE']),
                  isDefault: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const overrides = await loadNecessityOverrides(userId)
        const categories = CATEGORIES.filter(isNecessityCategory).map((category) => {
          const override = overrides.get(category)
          return {
            category,
            necessity: override ?? defaultNecessity(category),
            isDefault: override === undefined,
          }
        })
        return reply.send({ categories })
      },
    )
}
