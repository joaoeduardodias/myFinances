import { api } from './api'

export type GoalTarget =
  | { kind: 'CATEGORY'; category: string; targetCents: number }
  | { kind: 'SAVINGS'; targetPercent: number }

/** `value` em centavos no teto de categoria e em % na sobra; `partial` é o mês atual. */
export interface GoalMonth {
  month: string
  value: number
  met: boolean
  partial: boolean
}

export interface AdvisorGoal {
  id: string
  target: GoalTarget
  startMonth: string
  /** Do mês em que foi aceita até o atual, mais antigo primeiro. */
  months: GoalMonth[]
}

export interface AdvisorMessage {
  role: 'USER' | 'ASSISTANT'
  text: string
  /** Metas que o consultor propôs nesta resposta. */
  proposals: GoalTarget[] | null
}

export interface Advisor {
  summary: { day: string; points: string[] } | null
  questionsAvailable: boolean
  /** Conversa dos últimos 7 dias, mais antiga primeiro. */
  messages: AdvisorMessage[]
  goals: AdvisorGoal[]
}

export function getAdvisor() {
  return api.get('advisor').json<Advisor>()
}

// A API espera o Gemini até 60 s, duas vezes em 503; os 10 s padrão do ky cortariam antes.
const ASK_TIMEOUT_MS = 130_000

export function askAdvisor(question: string) {
  return api
    .post('advisor/questions', { json: { question }, timeout: ASK_TIMEOUT_MS })
    .json<{ answer: string | null; proposals: GoalTarget[] }>()
}

export async function clearAdvisorChat() {
  await api.delete('advisor/messages')
}

export function acceptAdvisorGoal(target: GoalTarget) {
  return api.post('advisor/goals', { json: target }).json<{ id: string }>()
}

export async function endAdvisorGoal(id: string) {
  await api.delete(`advisor/goals/${id}`)
}
