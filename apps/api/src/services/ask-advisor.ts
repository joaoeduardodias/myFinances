import type { FastifyBaseLogger } from 'fastify'

import type { GoalTarget } from '@/lib/advisor/goals'
import { isEmptyPack } from '@/lib/advisor/pack'
import { answerQuestion, type ChatTurn } from '@/lib/gemini/advisor'
import { GeminiUnavailableError } from '@/lib/gemini/client'
import type { IsoDate } from '@/lib/today'

import { takeAdvisorCall } from './advisor-quota'
import { loadAdvisorPack } from './load-advisor-pack'

export type AdvisorAnswer =
  | { kind: 'answer'; text: string; proposals: GoalTarget[] }
  | { kind: 'unavailable' }

export const NOT_ENOUGH_DATA_TEXT = 'Ainda não tenho dados suficientes para responder.'

/** Pergunta ao consultor; compartilhado com o WhatsApp. */
export async function askAdvisor(
  userId: string,
  question: string,
  today: IsoDate,
  deps: {
    answer?: typeof answerQuestion
    log?: Pick<FastifyBaseLogger, 'info'>
    history?: ChatTurn[]
  } = {},
): Promise<AdvisorAnswer> {
  const pack = await loadAdvisorPack(userId, today)
  // Sem dados não vale gastar cota do Gemini.
  if (isEmptyPack(pack)) return { kind: 'answer', text: NOT_ENOUGH_DATA_TEXT, proposals: [] }
  if (!(await takeAdvisorCall(today))) return { kind: 'unavailable' }
  try {
    const answer = await (deps.answer ?? answerQuestion)(pack, question, undefined, deps.history)
    return { kind: 'answer', ...answer }
  } catch (error) {
    if (error instanceof GeminiUnavailableError) {
      // Sem isso a falha só aparece como "indisponível" para o usuário.
      deps.log?.info(`Gemini indisponível no consultor: ${error.message}`)
      return { kind: 'unavailable' }
    }
    throw error
  }
}
