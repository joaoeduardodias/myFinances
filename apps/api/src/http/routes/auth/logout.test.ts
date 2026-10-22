import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { logout } = await import('./logout')

const userId = uuid('user')
const sessionId = uuid('session')

describe('POST /sessions/logout', () => {
  beforeEach(() => {
    resetPrismaMocks(prismaMock)
  })

  it('returns 204 for a refresh token that matches no session — no enumeration signal', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(logout)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/logout',
      cookies: { refresh_token: 'garbage' },
    })

    expect(response.statusCode).toBe(204)
    expect(prismaMock.userSession.update).not.toHaveBeenCalled()
  })

  it('returns 204 for an already-revoked session without revoking it again', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue({
      id: sessionId,
      userId,
      refreshTokenHash: 'any-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const app = await buildTestApp(logout)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/logout',
      cookies: { refresh_token: 'already-used' },
    })

    expect(response.statusCode).toBe(204)
    expect(prismaMock.userSession.update).not.toHaveBeenCalled()
  })

  it('revokes a live session and returns 204', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue({
      id: sessionId,
      userId,
      refreshTokenHash: 'any-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: null,
    })
    prismaMock.userSession.update.mockResolvedValue({
      id: sessionId,
      userId,
      refreshTokenHash: 'any-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: new Date(),
    })
    const app = await buildTestApp(logout)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/logout',
      cookies: { refresh_token: 'valid-token' },
    })

    expect(response.statusCode).toBe(204)
    expect(prismaMock.userSession.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { revokedAt: expect.any(Date) },
    })
  })

  // `SameSite=Strict` não separa subdomínios: outro app do mesmo domínio raiz
  // mandaria o cookie numa requisição forjada. O `Origin` separa.
  it('returns 401 for a request from another origin', async () => {
    const app = await buildTestApp(logout)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/logout',
      headers: { origin: 'https://outro-app.example.com' },
      cookies: { refresh_token: 'valid-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.userSession.findUnique).not.toHaveBeenCalled()
  })

  it('clears the refresh token cookie', async () => {
    const app = await buildTestApp(logout)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/logout',
    })

    expect(response.statusCode).toBe(204)
    const sessionCookie = response.cookies.find(
      (cookie) => cookie.name === 'refresh_token',
    )
    expect(sessionCookie?.value).toBe('')
  })
})
