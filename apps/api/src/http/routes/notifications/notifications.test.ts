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

const { getNotifications } = await import('./get-notifications')
const { readNotifications } = await import('./read-notifications')

const userA = uuid('user-a')

async function call(plugin: Parameters<typeof buildTestApp>[0], method: 'GET' | 'POST', url: string) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({ method, url, headers: authHeaders(token) })
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
})

describe('GET /notifications', () => {
  it('traz os 30 mais recentes e a contagem de não lidos', async () => {
    const createdAt = new Date('2026-10-01T12:00:00Z')
    prismaMock.notification.findMany.mockResolvedValue([
      { id: 'n1', kind: 'SPENDABLE_NEGATIVE', title: 'Saldo', body: 'Baixo', createdAt, readAt: null },
      { id: 'n2', kind: 'CATEGORY_EXCEEDED', title: 'Limite', body: 'Estourou', createdAt, readAt: new Date() },
    ])
    prismaMock.notification.count.mockResolvedValue(1)

    const res = await call(getNotifications, 'GET', '/notifications')

    expect(res.statusCode).toBe(200)
    expect(prismaMock.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: userA }, orderBy: { createdAt: 'desc' }, take: 30 }),
    )
    expect(prismaMock.notification.count).toHaveBeenCalledWith({ where: { userId: userA, readAt: null } })
    expect(res.json()).toEqual({
      unreadCount: 1,
      notifications: [
        { id: 'n1', kind: 'SPENDABLE_NEGATIVE', title: 'Saldo', body: 'Baixo', createdAt: createdAt.toISOString(), read: false },
        { id: 'n2', kind: 'CATEGORY_EXCEEDED', title: 'Limite', body: 'Estourou', createdAt: createdAt.toISOString(), read: true },
      ],
    })
  })
})

describe('POST /notifications/read', () => {
  it('marca como lidos só os do usuário', async () => {
    const res = await call(readNotifications, 'POST', '/notifications/read')
    expect(res.statusCode).toBe(204)
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: userA, readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })
})
