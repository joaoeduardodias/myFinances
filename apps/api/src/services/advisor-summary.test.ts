import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GeminiUnavailableError } from '@/lib/gemini/client'
import { makePrismaMock } from '@/test/helpers'

const prismaMock = makePrismaMock()
const takeAdvisorCall = vi.fn()
const loadAdvisorPack = vi.fn()
const isEmptyPack = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('./advisor-quota', () => ({ takeAdvisorCall }))
vi.mock('./load-advisor-pack', () => ({ loadAdvisorPack }))
vi.mock('@/lib/advisor/pack', () => ({ isEmptyPack }))

const { refreshAdvisorSummary, refreshAdvisorSummaryInBackground } = await import('./advisor-summary')

const USER = 'user-1'
const TODAY = '2026-10-29' as const

beforeEach(() => {
  vi.resetAllMocks()
  prismaMock.advisorSummary.findUnique.mockResolvedValue(null)
  loadAdvisorPack.mockResolvedValue({ pack: true })
  isEmptyPack.mockReturnValue(false)
  takeAdvisorCall.mockResolvedValue(true)
})

describe('refreshAdvisorSummary', () => {
  it('não faz nada quando o resumo de hoje já existe', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue({ day: TODAY, points: ['a'] })
    const write = vi.fn()
    await refreshAdvisorSummary(USER, TODAY, { write })
    expect(loadAdvisorPack).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('pacote vazio: não conta cota nem chama write', async () => {
    isEmptyPack.mockReturnValue(true)
    const write = vi.fn()
    await refreshAdvisorSummary(USER, TODAY, { write })
    expect(takeAdvisorCall).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('cota esgotada: não chama write', async () => {
    takeAdvisorCall.mockResolvedValue(false)
    const write = vi.fn()
    await refreshAdvisorSummary(USER, TODAY, { write })
    expect(write).not.toHaveBeenCalled()
    expect(prismaMock.advisorSummary.upsert).not.toHaveBeenCalled()
  })

  it('grava o resumo do dia', async () => {
    prismaMock.advisorSummary.findUnique.mockResolvedValue({ day: '2026-10-28', points: ['velho'] })
    const write = vi.fn().mockResolvedValue(['novo'])
    await refreshAdvisorSummary(USER, TODAY, { write })
    expect(write).toHaveBeenCalledWith({ pack: true })
    expect(prismaMock.advisorSummary.upsert).toHaveBeenCalledWith({
      where: { userId: USER },
      create: { userId: USER, day: TODAY, points: ['novo'] },
      update: { day: TODAY, points: ['novo'] },
    })
  })

  it('falha do Gemini deixa o resumo anterior', async () => {
    const write = vi.fn().mockRejectedValue(new GeminiUnavailableError('fora'))
    await expect(refreshAdvisorSummary(USER, TODAY, { write })).rejects.toBeInstanceOf(GeminiUnavailableError)
    expect(prismaMock.advisorSummary.upsert).not.toHaveBeenCalled()
  })
})

describe('refreshAdvisorSummaryInBackground', () => {
  it('engole e registra o erro', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    loadAdvisorPack.mockRejectedValue(new Error('boom'))
    expect(() => refreshAdvisorSummaryInBackground('user-err', TODAY)).not.toThrow()
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    spy.mockRestore()
  })

  it('não roda duas vezes ao mesmo tempo para o mesmo usuário', async () => {
    let release: () => void = () => {}
    loadAdvisorPack.mockReturnValue(new Promise<object>((r) => { release = () => r({}) }))
    refreshAdvisorSummaryInBackground('user-dup', TODAY)
    refreshAdvisorSummaryInBackground('user-dup', TODAY)
    await vi.waitFor(() => expect(loadAdvisorPack).toHaveBeenCalledTimes(1))
    release()
    await vi.waitFor(() => expect(takeAdvisorCall).toHaveBeenCalledTimes(1))
    expect(loadAdvisorPack).toHaveBeenCalledTimes(1)
  })
})
