import { describe, expect, it, vi } from 'vitest'

import type { AdvisorPack } from '../advisor/pack'
import { packPrompt } from '../advisor/pack'
import { answerQuestion, writeSummary } from './advisor'
import { GeminiUnavailableError } from './client'

const PACK: AdvisorPack = {
  today: '2026-10-15',
  spendable: { availableCents: 123456, perDayCents: 5000, untilDate: '2026-11-05', windowEnd: '2026-11-05', noIncomeConfigured: false },
  payables: [{ dueDate: '2026-10-20', amountCents: 80000 }],
  categories: [{ category: 'Restaurante', spentCents: 30000, limitCents: 50000 }],
  months: [],
  categoryHistory: [],
  limitsKept: null,
  indicators: { months: [], incomeTrend: null, risingCategories: [] },
  goals: [],
}

function run(raw: object) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }] }),
      ),
  )
  const deps = { fetch: fetchMock as unknown as typeof fetch, apiKey: 'k' }
  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body as string)
  return { deps, sent }
}

describe('writeSummary', () => {
  it('envia o pacote e devolve pontos limpos, no máximo 4', async () => {
    const { deps, sent } = run({
      points: ['  a  ', 'b', 'c', 'd', 'e', 'x'.repeat(200)],
    })
    const points = await writeSummary(PACK, deps)
    expect(points).toEqual(['a', 'b', 'c', 'd'])
    expect(sent().contents[0].parts).toEqual([{ text: packPrompt(PACK) }])
  })

  it('corta cada ponto em 160 caracteres', async () => {
    const { deps } = run({ points: ['x'.repeat(200)] })
    expect((await writeSummary(PACK, deps))[0]).toHaveLength(160)
  })

  it('lista vazia lança GeminiUnavailableError', async () => {
    const { deps } = run({ points: [] })
    await expect(writeSummary(PACK, deps)).rejects.toBeInstanceOf(GeminiUnavailableError)
  })

  it('JSON fora do formato lança GeminiUnavailableError', async () => {
    const { deps } = run({ nope: 1 })
    await expect(writeSummary(PACK, deps)).rejects.toBeInstanceOf(GeminiUnavailableError)
  })
})

describe('answerQuestion', () => {
  it('envia o pacote e a pergunta e devolve a resposta aparada e cortada', async () => {
    const { deps, sent } = run({ answer: `  ${'y'.repeat(2000)}  ` })
    const answer = await answerQuestion(PACK, 'Posso comprar um tênis?', deps)
    expect(answer.text).toHaveLength(1500)
    expect(answer.proposals).toEqual([])
    expect(sent().contents[0].parts).toEqual([
      { text: `${packPrompt(PACK)}\n\nPergunta: Posso comprar um tênis?` },
    ])
  })

  it('manda a conversa anterior antes da pergunta', async () => {
    const { deps, sent } = run({ answer: 'ok' })
    await answerQuestion(PACK, 'e no mês que vem?', deps, [
      { role: 'USER', text: 'como estou?' },
      { role: 'ASSISTANT', text: 'Atenção.' },
    ])
    expect(sent().contents[0].parts).toEqual([
      {
        text: `${packPrompt(PACK)}\n\nConversa até agora:\nPessoa: como estou?\nConsultor: Atenção.\n\nPergunta: e no mês que vem?`,
      },
    ])
  })

  it('devolve só as propostas de meta válidas', async () => {
    const { deps, sent } = run({
      answer: 'Corte Delivery.',
      goals: [
        { kind: 'CATEGORY', category: 'Delivery', targetReais: 300 },
        { kind: 'CATEGORY', category: 'Ifood', targetReais: 100 },
      ],
    })
    const answer = await answerQuestion(PACK, 'o que corto?', deps)
    expect(answer).toEqual({
      text: 'Corte Delivery.',
      proposals: [{ kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 }],
    })
    expect(sent().generationConfig.responseJsonSchema.properties.goals.type).toBe('array')
  })

  it('não repete meta já ativa', async () => {
    const { deps } = run({ answer: 'ok', goals: [{ kind: 'SAVINGS', targetPercent: 20 }] })
    const pack = { ...PACK, goals: [{ target: { kind: 'SAVINGS' as const, targetPercent: 20 }, startMonth: '2026-10', months: [] }] }
    expect((await answerQuestion(pack, 'oi', deps)).proposals).toEqual([])
  })

  it('resposta vazia lança GeminiUnavailableError', async () => {
    const { deps } = run({ answer: '   ' })
    await expect(answerQuestion(PACK, 'oi', deps)).rejects.toBeInstanceOf(GeminiUnavailableError)
  })
})

describe('tempo de espera do consultor', () => {
  it('resumo e pergunta esperam até 60 s pelo Gemini', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    await writeSummary(PACK, run({ points: ['a'] }).deps)
    await answerQuestion(PACK, 'oi', run({ answer: 'ok' }).deps)

    expect(timeout.mock.calls).toEqual([[60_000], [60_000]])
    timeout.mockRestore()
  })
})
