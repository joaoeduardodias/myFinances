import { z } from 'zod'

export const cardAccountSelect = {
  id: true,
  name: true,
  number: true,
  balanceCents: true,
  closingDay: true,
  dueDay: true,
} as const

export const cardAccountSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  number: z.string().nullable(),
  balanceCents: z.number().int(),
  closingDay: z.number().int().nullable(),
  dueDay: z.number().int().nullable(),
})

export const cardBillSchema = z.object({
  accountId: z.uuid(),
  closeDate: z.string(),
  dueDate: z.string(),
  amountCents: z.number().int(),
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  status: z.enum(['CLOSED', 'OPEN', 'FUTURE']),
  transactions: z.array(
    z.object({
      date: z.string(),
      amountCents: z.number().int(),
      isTransfer: z.boolean(),
      installmentNumber: z.number().int().nullish(),
      totalInstallments: z.number().int().nullish(),
      description: z.string(),
    }),
  ),
})

export const cardsMissingCycleSchema = z.array(z.object({ id: z.uuid(), name: z.string() }))
