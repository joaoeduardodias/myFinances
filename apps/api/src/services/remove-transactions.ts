import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/prisma/generated/client'

import { recomputeWalletBalance } from './wallet'

const partnerSelect = {
  select: { id: true, source: true, accountId: true, transferLocked: true },
} as const

/**
 * Apaga transações que sumiram da Pluggy sem deixar par pela metade: o outro
 * lado de uma transferência deixa de ser transferência (a não ser que o
 * usuário tenha travado a marca) e o crédito que um saque gerou na Carteira
 * vai junto, com o saldo dela recalculado. Devolve quantas apagou.
 */
export async function removeTransactions(where: Prisma.TransactionWhereInput): Promise<number> {
  const removed = await prisma.transaction.findMany({
    where,
    select: { id: true, transferPair: partnerSelect, transferPairOf: partnerSelect },
  })
  if (removed.length === 0) return 0

  const removedIds = new Set(removed.map((tx) => tx.id))
  const walletCreditIds: string[] = []
  const walletIds = new Set<string>()
  const unlinkIds: string[] = []
  for (const tx of removed) {
    for (const partner of [tx.transferPair, tx.transferPairOf]) {
      if (!partner || removedIds.has(partner.id)) continue
      if (partner.source === 'SYSTEM') {
        walletCreditIds.push(partner.id)
        walletIds.add(partner.accountId)
      } else if (!partner.transferLocked) {
        unlinkIds.push(partner.id)
      }
      // Travado: a marca fica; o vínculo cai sozinho (`onDelete: SetNull`).
    }
  }

  await prisma.$transaction(async (db) => {
    if (unlinkIds.length > 0) {
      await db.transaction.updateMany({
        where: { id: { in: unlinkIds } },
        data: { isTransfer: false, transferPairId: null },
      })
    }
    await db.transaction.deleteMany({
      where: { id: { in: [...removedIds, ...walletCreditIds] } },
    })
  })
  for (const walletId of walletIds) await recomputeWalletBalance(walletId)
  return removed.length
}
