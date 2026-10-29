import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()
const answerQuestion = vi.fn()
const loadAdvisorPack = vi.fn()
const isEmptyPack = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/gemini/advisor', () => ({ answerQuestion }))
vi.mock('@/services/load-advisor-pack', () => ({ loadAdvisorPack }))
vi.mock('@/lib/advisor/pack', () => ({ isEmptyPack }))

const { getAdvisor } = await import('./get-advisor')
const { askAdvisor: askAdvisorRoute } = await import('./ask-advisor')
const { askAdvisor } = await import('@/services/ask-advisor')
const { GeminiUnavailableError } = await import('@/lib/gemini/client')

const userA = uuid('user-a')
const filledPack = { hasData: true }

async function call(plugin: Parameters<typeof buildTestApp>[0], method: 'GET' | 'POST', url: string, payload?: object) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({ method, url, headers: authHeaders(token), payload })
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  answerQuestion.mockReset()
  loadAdvisorPack.mockReset()
  isEmptyPack.mockReset().mockReturnValue(false)
})

describe('GET /advisor', () => {
  it('sem resumo devolve null e perguntas disponíveis', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
    prismaMock.advisorUsage.findUnique.mockResolvedValue(null)

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ summary: null, questionsAvailable: true })
  })

  it('devolve o resumo guardado', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue({ userId: userA, day: '2026-10-29', points: ['a', 'b'] })
    prismaMock.advisorUsage.findUnique.mockResolvedValue({ day: '2026-10-29', calls: 99 })

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.json()).toEqual({ summary: { day: '2026-10-29', points: ['a', 'b'] }, questionsAvailable: true })
  })

  it('com 100 chamadas as perguntas ficam indisponíveis', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
    prismaMock.advisorUsage.findUnique.mockResolvedValue({ day: '2026-10-29', calls: 100 })

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.json().questionsAvailable).toBe(false)
    expect(answerQuestion).not.toHaveBeenCalled()
  })
})

describe('POST /advisor/questions', () => {
  it('caminho feliz devolve o texto', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 1 })
    answerQuestion.mockResolvedValue('Pode gastar R$ 50.')

    const res = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'Posso comprar?' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ answer: 'Pode gastar R$ 50.' })
  })

  it('com cota esgotada devolve null sem chamar a IA', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 101 })

    const res = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'Posso comprar?' })

    expect(res.json()).toEqual({ answer: null })
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('pergunta vazia ou com 301 caracteres dá 400', async () => {
    const empty = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: '   ' })
    const long = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'a'.repeat(301) })

    expect(empty.statusCode).toBe(400)
    expect(long.statusCode).toBe(400)
  })
})

describe('askAdvisor', () => {
  it('pacote vazio responde o texto fixo sem gastar cota', async () => {
    loadAdvisorPack.mockResolvedValue({})
    isEmptyPack.mockReturnValue(true)
    const answer = vi.fn()

    const result = await askAdvisor(userA, 'oi', '2026-10-29', { answer })

    expect(result).toEqual({ kind: 'answer', text: 'Ainda não tenho dados suficientes para responder.' })
    expect(prismaMock.advisorUsage.upsert).not.toHaveBeenCalled()
    expect(answer).not.toHaveBeenCalled()
  })

  it('sem cota não chama a IA', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 101 })
    const answer = vi.fn()

    expect(await askAdvisor(userA, 'oi', '2026-10-29', { answer })).toEqual({ kind: 'unavailable' })
    expect(answer).not.toHaveBeenCalled()
  })

  it('GeminiUnavailableError vira unavailable e outros erros sobem', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 1 })

    const down = vi.fn().mockRejectedValue(new GeminiUnavailableError('fora'))
    expect(await askAdvisor(userA, 'oi', '2026-10-29', { answer: down })).toEqual({ kind: 'unavailable' })

    const bug = vi.fn().mockRejectedValue(new Error('bug'))
    await expect(askAdvisor(userA, 'oi', '2026-10-29', { answer: bug })).rejects.toThrow('bug')
  })
})
