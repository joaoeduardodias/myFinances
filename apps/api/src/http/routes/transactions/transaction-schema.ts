import { z } from 'zod'

import { fromDbDate } from '@/lib/db-date'

export const transactionSelect = {
  id: true,
  accountId: true,
  date: true,
  description: true,
  amountCents: true,
  category: true,
  categoryLocked: true,
  isTransfer: true,
  source: true,
  account: { select: { name: true, type: true } },
} as const

export const transactionSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  date: z.string(),
  description: z.string(),
  amountCents: z.number().int(),
  category: z.string().nullable(),
  categoryLocked: z.boolean(),
  isTransfer: z.boolean(),
  source: z.enum(['PLUGGY', 'MANUAL', 'SYSTEM']),
  account: z.object({ name: z.string(), type: z.string() }),
})

/** Volta de `Date.UTC` igual ao texto: 2026-02-31 viraria 03/03 e é recusado. */
export function isCalendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).')
  .refine(isCalendarDate, 'Data inexistente no calendário.')

type TransactionRow = Omit<z.infer<typeof transactionSchema>, 'date' | 'account'> & {
  date: Date
  account: { name: string; type: string }
}

export function serializeTransaction(row: TransactionRow) {
  return { ...row, date: fromDbDate(row.date) }
}
