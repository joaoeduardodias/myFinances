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
const loadGoalsWithProgress = vi.fn()
vi.mock('@/services/advisor-goals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/advisor-goals')>()),
  loadGoalsWithProgress,
}))

const { getAdvisor } = await import('./get-advisor')
const { askAdvisor: askAdvisorRoute } = await import('./ask-advisor')
const { clearAdvisorChat } = await import('./clear-advisor-chat')
const { acceptAdvisorGoal } = await import('./accept-advisor-goal')
const { endAdvisorGoal } = await import('./end-advisor-goal')
const { askAdvisor } = await import('@/services/ask-advisor')
const { GeminiUnavailableError } = await import('@/lib/gemini/client')

const userA = uuid('user-a')
const filledPack = { hasData: true }

async function call(plugin: Parameters<typeof buildTestApp>[0], method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({ method, url, headers: authHeaders(token), payload })
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  answerQuestion.mockReset()
  loadAdvisorPack.mockReset()
  isEmptyPack.mockReset().mockReturnValue(false)
  prismaMock.advisorMessage.findMany.mockResolvedValue([])
  loadGoalsWithProgress.mockReset().mockResolvedValue([])
})

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

describe('GET /advisor', () => {
  it('sem resumo devolve null e perguntas disponíveis', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
    prismaMock.advisorUsage.findUnique.mockResolvedValue(null)

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ summary: null, questionsAvailable: true, messages: [], goals: [] })
  })

  it('devolve a conversa dos últimos 7 dias, mais antiga primeiro', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
    prismaMock.advisorUsage.findUnique.mockResolvedValue(null)
    const proposal = { kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 }
    prismaMock.advisorMessage.findMany.mockResolvedValue([
      { role: 'USER', text: 'como estou?', proposals: null },
      { role: 'ASSISTANT', text: 'Atenção.', proposals: [proposal] },
    ])
    const before = Date.now()

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.json().messages).toEqual([
      { role: 'USER', text: 'como estou?', proposals: null },
      { role: 'ASSISTANT', text: 'Atenção.', proposals: [proposal] },
    ])
    const args = prismaMock.advisorMessage.findMany.mock.calls[0][0]
    expect(args.where.userId).toBe(userA)
    expect(args.orderBy).toEqual({ createdAt: 'asc' })
    expect(before - args.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(WEEK_MS - 1000)
    expect(before - args.where.createdAt.gte.getTime()).toBeLessThanOrEqual(WEEK_MS + 1000)
  })

  it('devolve o resumo guardado', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue({ userId: userA, day: '2026-10-29', points: ['a', 'b'] })
    prismaMock.advisorUsage.findUnique.mockResolvedValue({ day: '2026-10-29', calls: 99 })

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.json()).toEqual({
      summary: { day: '2026-10-29', points: ['a', 'b'] },
      questionsAvailable: true,
      messages: [],
      goals: [],
    })
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
    answerQuestion.mockResolvedValue({ text: 'Pode gastar R$ 50.', proposals: [] })

    const res = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'Posso comprar?' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ answer: 'Pode gastar R$ 50.', proposals: [] })
  })

  it('guarda pergunta e resposta e manda a conversa da semana ao Gemini', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 1 })
    prismaMock.advisorMessage.findMany.mockResolvedValue([
      { role: 'USER', text: 'como estou?' },
      { role: 'ASSISTANT', text: 'Atenção.' },
    ])
    answerQuestion.mockResolvedValue({
      text: 'Corte R$ 200 de Delivery.',
      proposals: [{ kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 }],
    })

    await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'e agora?' })

    expect(answerQuestion).toHaveBeenCalledWith(filledPack, 'e agora?', undefined, [
      { role: 'USER', text: 'como estou?' },
      { role: 'ASSISTANT', text: 'Atenção.' },
    ])
    expect(prismaMock.advisorMessage.deleteMany.mock.calls[0][0].where.userId).toBe(userA)
    expect(prismaMock.advisorMessage.deleteMany.mock.calls[0][0].where.createdAt.lt).toBeInstanceOf(Date)
    const rows = prismaMock.advisorMessage.createMany.mock.calls[0][0].data
    expect(rows.map((r: { role: string; text: string }) => [r.role, r.text])).toEqual([
      ['USER', 'e agora?'],
      ['ASSISTANT', 'Corte R$ 200 de Delivery.'],
    ])
    expect(rows[1].createdAt.getTime()).toBeGreaterThan(rows[0].createdAt.getTime())
    expect(rows[1].proposals).toEqual([{ kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 }])
    expect(rows[0].proposals).toBeUndefined()
  })

  it('sem resposta não guarda nada', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 101 })

    await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'e agora?' })

    expect(prismaMock.advisorMessage.createMany).not.toHaveBeenCalled()
  })

  it('com cota esgotada devolve null sem chamar a IA', async () => {
    loadAdvisorPack.mockResolvedValue(filledPack)
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 101 })

    const res = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'Posso comprar?' })

    expect(res.json()).toEqual({ answer: null, proposals: [] })
    expect(answerQuestion).not.toHaveBeenCalled()
  })

  it('pergunta vazia ou com 301 caracteres dá 400', async () => {
    const empty = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: '   ' })
    const long = await call(askAdvisorRoute, 'POST', '/advisor/questions', { question: 'a'.repeat(301) })

    expect(empty.statusCode).toBe(400)
    expect(long.statusCode).toBe(400)
  })
})

describe('metas', () => {
  it('GET /advisor devolve as metas com andamento', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
    prismaMock.advisorUsage.findUnique.mockResolvedValue(null)
    const goal = {
      id: uuid('goal'),
      target: { kind: 'SAVINGS', targetPercent: 20 },
      startMonth: '2026-10',
      months: [{ month: '2026-10', value: 25, met: true, partial: true }],
    }
    loadGoalsWithProgress.mockResolvedValue([goal])

    const res = await call(getAdvisor, 'GET', '/advisor')

    expect(res.json().goals).toEqual([goal])
  })

  it('POST /advisor/goals encerra a ativa da mesma categoria e cria a nova no mês atual', async () => {
    prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock))
    prismaMock.advisorGoal.create.mockResolvedValue({ id: uuid('goal') })

    const res = await call(acceptAdvisorGoal, 'POST', '/advisor/goals', {
      kind: 'CATEGORY',
      category: 'Delivery',
      targetCents: 30000,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: uuid('goal') })
    expect(prismaMock.advisorGoal.updateMany.mock.calls[0][0].where).toEqual({
      userId: userA,
      endedAt: null,
      kind: 'CATEGORY',
      category: 'Delivery',
    })
    expect(prismaMock.advisorGoal.create.mock.calls[0][0].data).toMatchObject({
      userId: userA,
      kind: 'CATEGORY',
      category: 'Delivery',
      targetCents: 30000,
      targetPercent: null,
    })
    expect(prismaMock.advisorGoal.create.mock.calls[0][0].data.startMonth).toMatch(/^\d{4}-\d{2}$/)
  })

  it('POST /advisor/goals recusa categoria fora dos limites e sobra fora de 1–90%', async () => {
    const bad = await call(acceptAdvisorGoal, 'POST', '/advisor/goals', {
      kind: 'CATEGORY',
      category: 'Ifood',
      targetCents: 30000,
    })
    const high = await call(acceptAdvisorGoal, 'POST', '/advisor/goals', { kind: 'SAVINGS', targetPercent: 95 })

    expect(bad.statusCode).toBe(400)
    expect(high.statusCode).toBe(400)
  })

  it('DELETE /advisor/goals/:id encerra só a meta ativa do usuário', async () => {
    prismaMock.advisorGoal.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })

    const ok = await call(endAdvisorGoal, 'DELETE', `/advisor/goals/${uuid('goal')}`)
    const missing = await call(endAdvisorGoal, 'DELETE', `/advisor/goals/${uuid('other')}`)

    expect(ok.statusCode).toBe(204)
    expect(missing.statusCode).toBe(404)
    expect(prismaMock.advisorGoal.updateMany.mock.calls[0][0].where).toEqual({
      id: uuid('goal'),
      userId: userA,
      endedAt: null,
    })
  })
})

describe('DELETE /advisor/messages', () => {
  it('apaga a conversa do usuário', async () => {
    const res = await call(clearAdvisorChat, 'DELETE', '/advisor/messages')

    expect(res.statusCode).toBe(204)
    expect(prismaMock.advisorMessage.deleteMany).toHaveBeenCalledWith({ where: { userId: userA } })
  })
})

describe('askAdvisor', () => {
  it('pacote vazio responde o texto fixo sem gastar cota', async () => {
    loadAdvisorPack.mockResolvedValue({})
    isEmptyPack.mockReturnValue(true)
    const answer = vi.fn()

    const result = await askAdvisor(userA, 'oi', '2026-10-29', { answer })

    expect(result).toEqual({ kind: 'answer', text: 'Ainda não tenho dados suficientes para responder.', proposals: [] })
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
    const log = { info: vi.fn() }
    expect(await askAdvisor(userA, 'oi', '2026-10-29', { answer: down, log })).toEqual({
      kind: 'unavailable',
    })
    expect(log.info).toHaveBeenCalledWith('Gemini indisponível no consultor: fora')

    const bug = vi.fn().mockRejectedValue(new Error('bug'))
    await expect(askAdvisor(userA, 'oi', '2026-10-29', { answer: bug })).rejects.toThrow('bug')
  })
})
