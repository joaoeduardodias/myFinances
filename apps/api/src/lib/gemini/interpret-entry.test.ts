import { describe, expect, it, vi } from 'vitest'

import { CATEGORIES } from '../finance/categories'
import {
  type EntryAccount,
  GeminiUnavailableError,
  interpretEntry,
} from './interpret-entry'

const TODAY = '2026-10-23'

const ACCOUNTS: EntryAccount[] = [
  { id: 'nubank-cc', name: 'Nubank', type: 'BANK' },
  { id: 'nubank-card', name: 'Nubank Cartão', type: 'CREDIT' },
  { id: 'carteira', name: 'Carteira', type: 'WALLET' },
]

const base = {
  understood: true,
  missing: null,
  description: 'Almoço',
  amount: 45,
  direction: 'debit',
  accountId: 'nubank-cc',
  candidateAccountIds: [],
  date: TODAY,
  category: 'Alimentação',
}

function geminiResponse(raw: object, status = 200) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }],
    }),
    { status },
  )
}

function run(raw: object, text = 'almoço 45 pix nubank') {
  const fetchMock = vi.fn(async () => geminiResponse(raw))
  return {
    fetchMock,
    result: interpretEntry(
      { text, accounts: ACCOUNTS, today: TODAY },
      { fetch: fetchMock as unknown as typeof fetch, apiKey: 'k' },
    ),
  }
}

describe('interpretEntry', () => {
  it('devolve entry com débito negativo', async () => {
    const { result } = run(base)
    expect(await result).toEqual({
      kind: 'entry',
      accountId: 'nubank-cc',
      draft: {
        amountCents: -4500,
        description: 'Almoço',
        date: TODAY,
        category: 'Alimentação',
      },
    })
  })

  it('crédito vira centavos positivos', async () => {
    const { result } = run({ ...base, direction: 'credit', amount: 200 })
    expect(await result).toMatchObject({
      kind: 'entry',
      draft: { amountCents: 20000 },
    })
  })

  it('accountId fora da lista vira ask_account', async () => {
    const { result } = run({
      ...base,
      accountId: 'inventada',
      candidateAccountIds: ['nubank-card', 'outra'],
    })
    expect(await result).toMatchObject({
      kind: 'ask_account',
      candidateAccountIds: ['nubank-card'],
    })
  })

  it('amount 0 vira not_understood citando o valor', async () => {
    const { result } = run({ ...base, amount: 0 })
    const r = await result
    expect(r.kind).toBe('not_understood')
    expect(r).toMatchObject({ reply: expect.stringContaining('valor') })
  })

  it('data futura vira not_understood', async () => {
    const { result } = run({ ...base, date: '2026-10-24' })
    expect((await result).kind).toBe('not_understood')
  })

  it('data de 61 dias atrás vira not_understood; 60 passa', async () => {
    expect((await run({ ...base, date: '2026-08-23' }).result).kind).toBe(
      'not_understood',
    )
    expect((await run({ ...base, date: '2026-08-24' }).result).kind).toBe(
      'entry',
    )
  })

  it('sem conta e sem candidatos oferece BANK e CREDIT, sem a Carteira', async () => {
    const { result } = run({
      ...base,
      accountId: null,
      candidateAccountIds: [],
    })
    expect(await result).toMatchObject({
      kind: 'ask_account',
      candidateAccountIds: ['nubank-cc', 'nubank-card'],
    })
  })

  it('understood false vira not_understood com a pergunta do modelo', async () => {
    const { result } = run({ ...base, understood: false, missing: 'o valor' })
    expect(await result).toMatchObject({
      kind: 'not_understood',
      reply: expect.stringContaining('o valor'),
    })
  })

  it('o corpo não leva saldo e leva as categorias', async () => {
    const { fetchMock, result } = run(base)
    await result
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    const body = String(init.body)
    expect(body).not.toContain('balanceCents')
    for (const c of CATEGORIES) expect(body).toContain(c)
  })

  it('envia a imagem como inline_data base64', async () => {
    const fetchMock = vi.fn(async () => geminiResponse(base))
    await interpretEntry(
      {
        image: { data: Buffer.from('abc'), mimeType: 'image/jpeg' },
        accounts: ACCOUNTS,
        today: TODAY,
      },
      { fetch: fetchMock as unknown as typeof fetch, apiKey: 'k' },
    )
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = String(init.body)
    expect(body).toContain('inline_data')
    expect(body).toContain(Buffer.from('abc').toString('base64'))
  })

  it('429 lança GeminiUnavailableError', async () => {
    const fetchMock = vi.fn(async () => new Response('x', { status: 429 }))
    await expect(
      interpretEntry(
        { text: 'x', accounts: ACCOUNTS, today: TODAY },
        { fetch: fetchMock as unknown as typeof fetch, apiKey: 'k' },
      ),
    ).rejects.toBeInstanceOf(GeminiUnavailableError)
  })

  it('rede e JSON inválido lançam GeminiUnavailableError', async () => {
    const down = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(
      interpretEntry(
        { text: 'x', accounts: ACCOUNTS, today: TODAY },
        { fetch: down as unknown as typeof fetch, apiKey: 'k' },
      ),
    ).rejects.toBeInstanceOf(GeminiUnavailableError)
    const bad = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'não é json' }] } }],
          }),
        ),
    )
    await expect(
      interpretEntry(
        { text: 'x', accounts: ACCOUNTS, today: TODAY },
        { fetch: bad as unknown as typeof fetch, apiKey: 'k' },
      ),
    ).rejects.toBeInstanceOf(GeminiUnavailableError)
  })

  it('sem chave lança GeminiUnavailableError', async () => {
    await expect(
      interpretEntry(
        { text: 'x', accounts: ACCOUNTS, today: TODAY },
        { fetch: vi.fn() as unknown as typeof fetch, apiKey: '' },
      ),
    ).rejects.toBeInstanceOf(GeminiUnavailableError)
  })

  it('o schema enviado é JSON Schema padrão, sem nullable', async () => {
    const { fetchMock, result } = run(base)
    await result
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body))
    const schema = sent.generationConfig.responseJsonSchema
    expect(JSON.stringify(schema)).not.toContain('nullable')
    expect(schema.properties.amount.type).toContain('null')
    expect(schema.properties.accountId.type).toContain('null')
    expect(schema.properties.category.anyOf).toContainEqual({ type: 'null' })
  })

  it('manda um signal de timeout e aborto vira GeminiUnavailableError', async () => {
    const { fetchMock, result } = run(base)
    await result
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const aborted = vi.fn(async () => {
      throw new DOMException('timeout', 'AbortError')
    })
    await expect(
      interpretEntry(
        { text: 'x', accounts: ACCOUNTS, today: TODAY },
        { fetch: aborted as unknown as typeof fetch, apiKey: 'k' },
      ),
    ).rejects.toBeInstanceOf(GeminiUnavailableError)
  })

  it('data inexistente no calendário vira not_understood', async () => {
    const { result } = run({ ...base, date: '2026-09-31' })
    expect((await result).kind).toBe('not_understood')
  })
})
