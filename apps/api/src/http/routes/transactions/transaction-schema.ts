import { z } from 'zod'

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

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD).')

/** 'YYYY-MM-DD' para a meia-noite UTC, que é como o Prisma grava `@db.Date`. */
export function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

type TransactionRow = Omit<z.infer<typeof transactionSchema>, 'date' | 'account'> & {
  date: Date
  account: { name: string; type: string }
}

export function serializeTransaction(row: TransactionRow) {
  return { ...row, date: row.date.toISOString().slice(0, 10) }
}
