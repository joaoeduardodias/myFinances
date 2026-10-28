import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LIMIT_CATEGORIES } from '@/lib/finance/category-limits'
import { todayIso } from '@/lib/today'
import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { getCategoryLimits } = await import('./get-category-limits')
const { updateCategoryLimit } = await import('./update-category-limit')
const { declineCategoryLimit } = await import('./decline-category-limit')

const userA = uuid('user-a')
const month = todayIso().slice(0, 7)

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'PUT' | 'DELETE'; url: string; body?: unknown },
) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: authHeaders(token),
    ...(opts.body ? { payload: opts.body as object } : {}),
  })
}

function monthsAgo(n: number) {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 - n, 10))
}

function spend(monthsBack: number, category: string, cents: number) {
  return {
    id: `${category}-${monthsBack}`,
    date: monthsAgo(monthsBack),
    description: 'Compra',
    amountCents: -cents,
    category,
    necessity: null,
    categoryLocked: false,
    isTransfer: false,
    account: { type: 'BANK', name: 'Conta' },
  }
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.categoryNecessity.findMany.mockResolvedValue([])
})

describe('GET /category-limits', () => {
  function seed(rows: unknown[]) {
    prismaMock.transaction.findMany.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [spend(n, 'Mercado', 50_000), spend(n, 'Delivery', 20_000)]),
    )
    prismaMock.transaction.findFirst.mockResolvedValue({ date: monthsAgo(7) })
    prismaMock.categoryLimit.findMany.mockResolvedValue(rows)
  }

  it('lista as categorias de limite, na ordem, com proposta para as novas', async () => {
    seed([])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.month).toBe(month)
    expect(body.limits.map((l: { category: string }) => l.category)).toEqual(LIMIT_CATEGORIES)
    expect(body.limits).toHaveLength(LIMIT_CATEGORIES.length)
    expect(prismaMock.categoryLimit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: userA } }),
    )
    expect(body.limits.find((l: { category: string }) => l.category === 'Mercado')).toEqual({
      category: 'Mercado',
      status: 'NEW',
      limitCents: null,
      proposedCents: 50_000,
      spentCents: 0,
    })
  })

  it('ACTIVE já revisto no mês não propõe nada e traz o gasto do mês', async () => {
    seed([{ category: 'Mercado', status: 'ACTIVE', limitCents: 10_000, reviewedMonth: month }])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    const mercado = res.json().limits.find((l: { category: string }) => l.category === 'Mercado')
    expect(mercado).toMatchObject({ status: 'ACTIVE', limitCents: 10_000, proposedCents: null })
  })

  it('ACTIVE que precisa de revisão propõe a mediana nova', async () => {
    seed([{ category: 'Mercado', status: 'ACTIVE', limitCents: 10_000, reviewedMonth: null }])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    const mercado = res.json().limits.find((l: { category: string }) => l.category === 'Mercado')
    expect(mercado).toMatchObject({ status: 'ACTIVE', limitCents: 10_000, proposedCents: 50_000 })
  })

  it('revisão só olha meses em que o limite já valia', async () => {
    seed([{ category: 'Mercado', status: 'ACTIVE', limitCents: 10_000, reviewedMonth: monthsAgo(1).toISOString().slice(0, 7) }])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    const mercado = res.json().limits.find((l: { category: string }) => l.category === 'Mercado')
    expect(mercado).toMatchObject({ status: 'ACTIVE', limitCents: 10_000, proposedCents: null })
  })

  it('gasto do mês nunca fica negativo', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { ...spend(0, 'Mercado', 5_000), amountCents: 5_000, id: 'estorno' },
    ])
    prismaMock.transaction.findFirst.mockResolvedValue({ date: monthsAgo(1) })
    prismaMock.categoryLimit.findMany.mockResolvedValue([])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    const mercado = res.json().limits.find((l: { category: string }) => l.category === 'Mercado')
    expect(mercado.spentCents).toBe(0)
  })

  it('DECLINED não tem limite nem proposta', async () => {
    seed([{ category: 'Mercado', status: 'DECLINED', limitCents: null, reviewedMonth: null }])
    const res = await call(getCategoryLimits, { method: 'GET', url: '/category-limits' })
    const mercado = res.json().limits.find((l: { category: string }) => l.category === 'Mercado')
    expect(mercado).toMatchObject({ status: 'DECLINED', limitCents: null, proposedCents: null })
  })
})

describe('PUT /category-limits/:category', () => {
  it('grava ACTIVE com o mês atual revisto', async () => {
    const res = await call(updateCategoryLimit, {
      method: 'PUT',
      url: '/category-limits/Mercado',
      body: { limitCents: 80_000 },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.categoryLimit.upsert).toHaveBeenCalledWith({
      where: { userId_category: { userId: userA, category: 'Mercado' } },
      create: { userId: userA, category: 'Mercado', status: 'ACTIVE', limitCents: 80_000, reviewedMonth: month },
      update: { status: 'ACTIVE', limitCents: 80_000, reviewedMonth: month },
    })
  })

  it('recusa limite zero', async () => {
    const res = await call(updateCategoryLimit, {
      method: 'PUT',
      url: '/category-limits/Mercado',
      body: { limitCents: 0 },
    })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.categoryLimit.upsert).not.toHaveBeenCalled()
  })

  it('recusa categoria sem limite', async () => {
    for (const name of ['Salário', 'Outros', 'Inexistente']) {
      const res = await call(updateCategoryLimit, {
        method: 'PUT',
        url: `/category-limits/${encodeURIComponent(name)}`,
        body: { limitCents: 1000 },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(prismaMock.categoryLimit.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /category-limits/:category', () => {
  it('grava DECLINED sem limite', async () => {
    const res = await call(declineCategoryLimit, { method: 'DELETE', url: '/category-limits/Mercado' })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.categoryLimit.upsert).toHaveBeenCalledWith({
      where: { userId_category: { userId: userA, category: 'Mercado' } },
      create: { userId: userA, category: 'Mercado', status: 'DECLINED', limitCents: null },
      update: { status: 'DECLINED', limitCents: null },
    })
  })

  it('recusa categoria sem limite', async () => {
    for (const name of ['Salário', 'Outros', 'Inexistente']) {
      const res = await call(declineCategoryLimit, {
        method: 'DELETE',
        url: `/category-limits/${encodeURIComponent(name)}`,
      })
      expect(res.statusCode).toBe(400)
    }
    expect(prismaMock.categoryLimit.upsert).not.toHaveBeenCalled()
  })
})
