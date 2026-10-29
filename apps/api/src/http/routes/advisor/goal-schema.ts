import { z } from 'zod'

import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'

/** GoalTarget na borda HTTP: teto de categoria de limite ou sobra de 1 a 90% da renda. */
export const goalTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CATEGORY'),
    category: z.enum(LIMIT_CATEGORIES as [string, ...string[]]),
    targetCents: z.number().int().min(100).max(100_000_000),
  }),
  z.object({ kind: z.literal('SAVINGS'), targetPercent: z.number().int().min(1).max(90) }),
])

export const goalMonthSchema = z.object({
  month: z.string(),
  value: z.number(),
  met: z.boolean(),
  partial: z.boolean(),
})
