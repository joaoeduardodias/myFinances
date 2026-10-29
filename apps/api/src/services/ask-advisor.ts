import { isEmptyPack } from '@/lib/advisor/pack'
import { answerQuestion } from '@/lib/gemini/advisor'
import { GeminiUnavailableError } from '@/lib/gemini/client'
import type { IsoDate } from '@/lib/today'

import { takeAdvisorCall } from './advisor-quota'
import { loadAdvisorPack } from './load-advisor-pack'

export type AdvisorAnswer = { kind: 'answer'; text: string } | { kind: 'unavailable' }

export const NOT_ENOUGH_DATA_TEXT = 'Ainda não tenho dados suficientes para responder.'

/** Pergunta ao consultor; compartilhado com o WhatsApp. */
export async function askAdvisor(
  userId: string,
  question: string,
  today: IsoDate,
  deps: { answer?: typeof answerQuestion } = {},
): Promise<AdvisorAnswer> {
  const pack = await loadAdvisorPack(userId, today)
  // Sem dados não vale gastar cota do Gemini.
  if (isEmptyPack(pack)) return { kind: 'answer', text: NOT_ENOUGH_DATA_TEXT }
  if (!(await takeAdvisorCall(today))) return { kind: 'unavailable' }
  try {
    return { kind: 'answer', text: await (deps.answer ?? answerQuestion)(pack, question) }
  } catch (error) {
    if (error instanceof GeminiUnavailableError) return { kind: 'unavailable' }
    throw error
  }
}
