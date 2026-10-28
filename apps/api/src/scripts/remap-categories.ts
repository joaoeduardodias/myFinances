import { mapPluggyCategory } from '@/lib/finance/categories'
import { remapLegacyCategory } from '@/lib/finance/remap-legacy-category'
import { prisma } from '@/lib/prisma'

async function remapUser(userId: string) {
  const txs = await prisma.transaction.findMany({
    where: { userId },
    select: {
      id: true,
      descriptionKey: true,
      pluggyTransactionId: true,
      pluggyCategory: true,
      category: true,
      categoryLocked: true,
      date: true,
      createdAt: true,
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })

  // Categoria da Pluggy da transação mais recente de cada descrição.
  const pluggyByKey = new Map<string, string>()
  for (const tx of txs) {
    if (tx.descriptionKey && tx.pluggyCategory && !pluggyByKey.has(tx.descriptionKey)) {
      pluggyByKey.set(tx.descriptionKey, tx.pluggyCategory)
    }
  }

  let rulesChanged = 0
  const ruleByKey = new Map<string, string>()
  for (const rule of await prisma.categoryRule.findMany({ where: { userId } })) {
    const next = remapLegacyCategory(rule.category, pluggyByKey.get(rule.descriptionKey) ?? null)
    if (!next) {
      await prisma.categoryRule.delete({ where: { id: rule.id } })
      rulesChanged++
      continue
    }
    ruleByKey.set(rule.descriptionKey, next)
    if (next !== rule.category) {
      await prisma.categoryRule.update({ where: { id: rule.id }, data: { category: next } })
      rulesChanged++
    }
  }

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
      // Mesma prioridade do sync: regra pela descrição, senão a categoria da Pluggy.
      next = (tx.descriptionKey && ruleByKey.get(tx.descriptionKey)) || mapPluggyCategory(tx.pluggyCategory)
    }
    if (next === tx.category) continue
    await prisma.transaction.update({ where: { id: tx.id }, data: { category: next } })
    if (tx.categoryLocked) lockedChanged++
    else unlockedChanged++
  }

  return { rulesChanged, lockedChanged, unlockedChanged }
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } })
  const total = { rulesChanged: 0, lockedChanged: 0, unlockedChanged: 0 }
  for (const user of users) {
    const r = await remapUser(user.id)
    console.log(`${user.email}: regras ${r.rulesChanged}, travadas ${r.lockedChanged}, não travadas ${r.unlockedChanged}`)
    total.rulesChanged += r.rulesChanged
    total.lockedChanged += r.lockedChanged
    total.unlockedChanged += r.unlockedChanged
  }
  console.log(`Mudanças: regras ${total.rulesChanged}, travadas ${total.lockedChanged}, não travadas ${total.unlockedChanged}`)
  process.exit(0)
}

main().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
