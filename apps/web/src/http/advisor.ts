import { api } from './api'

export interface Advisor {
  summary: { day: string; points: string[] } | null
  questionsAvailable: boolean
}

export function getAdvisor() {
  return api.get('advisor').json<Advisor>()
}

export function askAdvisor(question: string) {
  return api
    .post('advisor/questions', { json: { question } })
    .json<{ answer: string | null }>()
}
