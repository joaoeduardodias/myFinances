import { describe, expect, it, vi } from 'vitest'

import type { AdvisorPack } from '../advisor/pack'
import { packPrompt } from '../advisor/pack'
import { answerQuestion, writeSummary } from './advisor'
import { GeminiUnavailableError } from './client'

const PACK: AdvisorPack = {
  today: '2026-10-15',
  spendable: { availableCents: 123456, perDayCents: 5000, untilDate: '2026-11-05', noIncomeConfigured: false },
  payables: [{ dueDate: '2026-10-20', amountCents: 80000 }],
  categories: [{ category: 'Restaurante', spentCents: 30000, limitCents: 50000 }],
  months: [],
  categoryHistory: [],
  limitsKept: null,
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
    const { deps, sent } = run({ answer: `  ${'y'.repeat(700)}  ` })
    const answer = await answerQuestion(PACK, 'Posso comprar um tênis?', deps)
    expect(answer).toHaveLength(600)
    expect(sent().contents[0].parts).toEqual([
      { text: `${packPrompt(PACK)}\n\nPergunta: Posso comprar um tênis?` },
    ])
  })

  it('resposta vazia lança GeminiUnavailableError', async () => {
    const { deps } = run({ answer: '   ' })
    await expect(answerQuestion(PACK, 'oi', deps)).rejects.toBeInstanceOf(GeminiUnavailableError)
  })
})
