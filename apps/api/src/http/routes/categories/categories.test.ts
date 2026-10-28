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

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { getCategoryNecessities } = await import('./get-category-necessities')
const { updateCategoryNecessity } = await import('./update-category-necessity')

const userA = uuid('user-a')

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'PUT'; url: string; body?: unknown },
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

beforeEach(() => {
  resetPrismaMocks(prismaMock)
})

describe('GET /category-necessities', () => {
  it('junta o padrão e a troca do usuário', async () => {
    prismaMock.categoryNecessity.findMany.mockResolvedValue([
      { category: 'Delivery', necessity: 'ESSENTIAL' },
    ])
    const res = await call(getCategoryNecessities, { method: 'GET', url: '/category-necessities' })
    expect(res.statusCode).toBe(200)
    const { categories } = res.json()
    expect(prismaMock.categoryNecessity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: userA } }),
    )
    expect(categories.find((c: { category: string }) => c.category === 'Delivery')).toEqual({
      category: 'Delivery',
      necessity: 'ESSENTIAL',
      isDefault: false,
    })
    expect(categories.find((c: { category: string }) => c.category === 'Mercado')).toEqual({
      category: 'Mercado',
      necessity: 'ESSENTIAL',
      isDefault: true,
    })
    const names = categories.map((c: { category: string }) => c.category)
    expect(names).not.toContain('Salário')
    expect(names[0]).toBe('Mercado')
  })
})

describe('PUT /category-necessities/:category', () => {
  it('recusa categoria sem padrão', async () => {
    for (const name of ['Salário', 'Outros', 'Inexistente']) {
      const res = await call(updateCategoryNecessity, {
        method: 'PUT',
        url: `/category-necessities/${encodeURIComponent(name)}`,
        body: { necessity: 'ESSENTIAL' },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(prismaMock.categoryNecessity.upsert).not.toHaveBeenCalled()
  })

  it('grava a troca', async () => {
    const res = await call(updateCategoryNecessity, {
      method: 'PUT',
      url: `/category-necessities/${encodeURIComponent('Delivery')}`,
      body: { necessity: 'ESSENTIAL' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.categoryNecessity.upsert).toHaveBeenCalledWith({
      where: { userId_category: { userId: userA, category: 'Delivery' } },
      create: { userId: userA, category: 'Delivery', necessity: 'ESSENTIAL' },
      update: { necessity: 'ESSENTIAL' },
    })
  })

  it('igual ao padrão apaga a troca', async () => {
    const res = await call(updateCategoryNecessity, {
      method: 'PUT',
      url: `/category-necessities/${encodeURIComponent('Delivery')}`,
      body: { necessity: 'AVOIDABLE' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.categoryNecessity.deleteMany).toHaveBeenCalledWith({
      where: { userId: userA, category: 'Delivery' },
    })
    expect(prismaMock.categoryNecessity.upsert).not.toHaveBeenCalled()
  })
})
