import type { Prisma } from '@/prisma/generated/client'

export const identicalTxSelect = { id: true, accountId: true, amountCents: true, descriptionKey: true } as const

type IdenticalTx = { id: string; accountId: string; amountCents: number; descriptionKey: string }

/**
 * As outras iguais a esta: mesmo texto do banco, valor e conta. Mudanças só
 * chegam a elas quando o usuário confirma; chave vazia (só dígitos) não
 * identifica nada.
 */
export function identicalWhere(userId: string, tx: IdenticalTx): Prisma.TransactionWhereInput | null {
  if (!tx.descriptionKey) return null
  return {
    userId,
    descriptionKey: tx.descriptionKey,
    amountCents: tx.amountCents,
    accountId: tx.accountId,
    id: { not: tx.id },
  }
}
