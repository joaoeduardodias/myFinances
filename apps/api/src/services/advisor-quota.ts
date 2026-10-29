import { prisma } from '@/lib/prisma'
import { isUniqueViolation } from '@/lib/prisma-errors'
import type { IsoDate } from '@/lib/today'

/** Parte do free tier diário do Gemini reservada ao consultor; o resto fica para o WhatsApp. */
export const ADVISOR_DAILY_CALLS = 100

function countCall(day: IsoDate) {
  return prisma.advisorUsage.upsert({
    where: { day },
    create: { day, calls: 1 },
    update: { calls: { increment: 1 } },
  })
}

/** Conta uma chamada ao Gemini no dia; `false` quando passou do limite. */
export async function takeAdvisorCall(day: IsoDate): Promise<boolean> {
  let usage: { calls: number }
  try {
    usage = await countCall(day)
  } catch (error) {
    // Duas primeiras chamadas do dia ao mesmo tempo: a outra criou a linha, então agora é update.
    if (!isUniqueViolation(error)) throw error
    usage = await countCall(day)
  }
  return usage.calls <= ADVISOR_DAILY_CALLS
}
