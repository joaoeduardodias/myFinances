import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authHeaders, buildTestApp, makePrismaMock, resetPrismaMocks, signToken, uuid } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/today', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/today')>()),
  todayIso: () => '2026-10-27',
}))

const { getAnalysis } = await import('./get-analysis')
const { getAnalysisTransactions } = await import('./get-analysis-transactions')

const userA = uuid('user-a')

const tx = (fields: Record<string, unknown>) => ({
  id: uuid(String(fields.description)),
  date: new Date('2026-10-10T00:00:00Z'),
  description: 'X',
  amountCents: -1000,
  category: null,
  necessity: null,
  categoryLocked: false,
  isTransfer: false,
  account: { type: 'BANK', name: 'Itaú' },
  ...fields,
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.categoryNecessity.findMany.mockResolvedValue([])
  prismaMock.transaction.findFirst.mockResolvedValue({ date: new Date('2025-01-05T00:00:00Z') })
  prismaMock.transaction.findMany.mockResolvedValue([
    tx({ description: 'Mercado', amountCents: -30000, category: 'Mercado', account: { type: 'CREDIT', name: 'Nubank' } }),
    tx({ description: 'Pix amigo', amountCents: -5000, category: null }),
    tx({ description: 'Fatura', amountCents: -90000, category: 'Mercado', isTransfer: true }),
    tx({ description: 'Salário', amountCents: 400000, category: 'Salário' }),
  ])
})

const get = async (url: string) => {
  const app = await buildTestApp(getAnalysis, getAnalysisTransactions)
  const token = await signToken(app, { sub: userA })
  return app.inject({ method: 'GET', url, headers: authHeaders(token) })
}

describe('GET /analysis', () => {
  it('devolve 12 meses e os totais do usuário', async () => {
    const response = await get('/analysis')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.months).toHaveLength(12)
    expect(body.from).toBe('2025-11-01')
    expect(body.to).toBe('2026-10-27')
    expect(body.totals.incomeCents).toBe(400000)
    expect(body.categories.map((c: { category: string | null }) => c.category)).toContain('Mercado')
    expect(body.uncategorized).toEqual({ count: 1, totalCents: 5000 })
  })

  it.each(['2026-13', 'abc', '2025-10', '2026-11'])('month inválido ou fora da janela (%s) → 400', async (month) => {
    expect((await get(`/analysis?month=${month}`)).statusCode).toBe(400)
    expect((await get(`/analysis/transactions?category=none&month=${month}`)).statusCode).toBe(400)
  })

  it('aceita month dentro da janela', async () => {
    expect((await get('/analysis?month=2025-11')).statusCode).toBe(200)
  })

  it('só enxerga transações do próprio usuário', async () => {
    await get('/analysis')
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toMatchObject({ userId: userA })
    expect(prismaMock.transaction.findFirst.mock.calls[0][0].where).toMatchObject({ userId: userA })
    expect(prismaMock.categoryNecessity.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
  })
})

describe('GET /analysis/transactions', () => {
  it('exige category', async () => {
    expect((await get('/analysis/transactions')).statusCode).toBe(400)
  })

  it('de uma categoria inclui compra no cartão e exclui transferência', async () => {
    const response = await get('/analysis/transactions?category=Mercado')
    expect(response.statusCode).toBe(200)
    const { transactions } = response.json()
    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({
      description: 'Mercado',
      amountCents: -30000,
      accountName: 'Nubank',
      group: 'essential',
      categoryLocked: false,
    })
  })

  it('com category=none lista os débitos sem categoria', async () => {
    const { transactions } = (await get('/analysis/transactions?category=none')).json()
    expect(transactions.map((t: { description: string }) => t.description)).toEqual(['Pix amigo'])
  })
})
