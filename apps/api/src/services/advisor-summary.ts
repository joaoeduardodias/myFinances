import { isEmptyPack } from '@/lib/advisor/pack'
import { writeSummary } from '@/lib/gemini/advisor'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { takeAdvisorCall } from './advisor-quota'
import { loadAdvisorPack } from './load-advisor-pack'

/**
 * Regenera o resumo guardado, no máximo uma vez por dia. A ordem das saídas
 * antecipadas poupa o banco e a cota: o mais barato primeiro.
 */
export async function refreshAdvisorSummary(
  userId: string,
  today: IsoDate,
  deps: { write?: typeof writeSummary } = {},
): Promise<void> {
  const current = await prisma.advisorSummary.findUnique({ where: { userId }, select: { day: true } })
  if (current?.day === today) return

  const pack = await loadAdvisorPack(userId, today)
  if (isEmptyPack(pack)) return
  if (!(await takeAdvisorCall(today))) return

  const points = await (deps.write ?? writeSummary)(pack)
  await prisma.advisorSummary.upsert({
    where: { userId },
    create: { userId, day: today, points },
    update: { day: today, points },
  })
}

// Em memória, como o sync: vale para uma instância só.
const running = new Set<string>()

/** Dispara sem esperar; qualquer erro é só registrado, nunca chega ao chamador. */
export function refreshAdvisorSummaryInBackground(userId: string, today: IsoDate): void {
  if (running.has(userId)) return
  running.add(userId)
  void refreshAdvisorSummary(userId, today)
    .catch((error) => console.error('Falha ao atualizar o resumo do consultor', error))
    .finally(() => running.delete(userId))
}
