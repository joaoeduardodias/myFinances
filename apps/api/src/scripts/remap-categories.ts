import { mapPluggyCategory } from '@/lib/finance/categories'
import { remapLegacyCategory } from '@/lib/finance/remap-legacy-category'
import { prisma } from '@/lib/prisma'

async function remapUser(userId: string) {
  const txs = await prisma.transaction.findMany({
    where: { userId },
    select: {
      id: true,
      pluggyTransactionId: true,
      pluggyCategory: true,
      category: true,
      categoryLocked: true,
    },
  })

  let lockedChanged = 0
  let unlockedChanged = 0
  for (const tx of txs) {
    let next: string | null
    if (tx.categoryLocked) {
      next = remapLegacyCategory(tx.category, tx.pluggyCategory)
    } else if (!tx.pluggyTransactionId) {
      // Lançamento manual: a Pluggy ainda não trouxe a transação.
      next = remapLegacyCategory(tx.category, null)
    } else {
      // Como o sync: a categoria da Pluggy.
      next = mapPluggyCategory(tx.pluggyCategory)
    }
    if (next === tx.category) continue
    await prisma.transaction.update({ where: { id: tx.id }, data: { category: next } })
    if (tx.categoryLocked) lockedChanged++
    else unlockedChanged++
  }

  return { lockedChanged, unlockedChanged }
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } })
  const total = { lockedChanged: 0, unlockedChanged: 0 }
  for (const user of users) {
    const r = await remapUser(user.id)
    console.log(`${user.email}: travadas ${r.lockedChanged}, não travadas ${r.unlockedChanged}`)
    total.lockedChanged += r.lockedChanged
    total.unlockedChanged += r.unlockedChanged
  }
  console.log(`Mudanças: travadas ${total.lockedChanged}, não travadas ${total.unlockedChanged}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
