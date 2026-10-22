import { prisma } from '@/lib/prisma'
import type { Account } from '@/prisma/generated/client'

function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  )
}

/** A Carteira do usuário, criada na primeira vez. Uma por usuário (índice parcial). */
export async function ensureWalletAccount(userId: string): Promise<Account> {
  const existing = await prisma.account.findFirst({ where: { userId, type: 'WALLET' } })
  if (existing) return existing
  try {
    return await prisma.account.create({
      data: { userId, type: 'WALLET', name: 'Carteira', balanceCents: 0 },
    })
  } catch (error) {
    // Outra requisição criou a Carteira entre o find e o create.
    if (!isUniqueViolation(error)) throw error
    return prisma.account.findFirstOrThrow({ where: { userId, type: 'WALLET' } })
  }
}

/** A Carteira não tem saldo vindo de fora: é a soma das transações dela. */
export async function recomputeWalletBalance(walletId: string): Promise<void> {
  const { _sum } = await prisma.transaction.aggregate({
    where: { accountId: walletId },
    _sum: { amountCents: true },
  })
  await prisma.account.update({
    where: { id: walletId },
    data: { balanceCents: _sum.amountCents ?? 0 },
  })
}
