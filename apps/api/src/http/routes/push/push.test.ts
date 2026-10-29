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

const { getPushPublicKey } = await import('./get-push-public-key')
const { subscribePush } = await import('./subscribe-push')
const { unsubscribePush } = await import('./unsubscribe-push')

const userA = uuid('user-a')
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc'

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({ method, url, headers: authHeaders(token), payload })
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
})

describe('GET /push/public-key', () => {
  it('devolve a chave VAPID pública', async () => {
    const res = await call(getPushPublicKey, 'GET', '/push/public-key')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ publicKey: 'test-vapid-public-key' })
  })
})

describe('POST /push/subscriptions', () => {
  it('grava a inscrição para o usuário, assumindo o endpoint se já existir', async () => {
    const res = await call(subscribePush, 'POST', '/push/subscriptions', {
      endpoint,
      keys: { p256dh: 'p', auth: 'a' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint },
      create: { userId: userA, endpoint, p256dh: 'p', auth: 'a' },
      update: { userId: userA, p256dh: 'p', auth: 'a' },
    })
  })

  it('recusa endpoint sem HTTPS', async () => {
    const res = await call(subscribePush, 'POST', '/push/subscriptions', {
      endpoint: 'http://169.254.169.254/latest',
      keys: { p256dh: 'p', auth: 'a' },
    })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.pushSubscription.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /push/subscriptions', () => {
  it('apaga só a inscrição do próprio usuário', async () => {
    const res = await call(unsubscribePush, 'DELETE', '/push/subscriptions', { endpoint })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: userA, endpoint },
    })
  })
})
