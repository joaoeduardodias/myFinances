import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashRefreshToken } from '@/lib/rotating-session-token'
import {
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { refreshSession } = await import('./refresh-session')

const userId = uuid('user')
const sessionId = uuid('session')

describe('POST /sessions/refresh', () => {
  beforeEach(() => {
    resetPrismaMocks(prismaMock)
  })

  it('returns 401 for a refresh token that matches no session', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      cookies: { refresh_token: 'garbage' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns 401 for a revoked session', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue({
      id: sessionId,
      userId,
      refreshTokenHash: 'any-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-09-01T00:00:00.000Z'),
    })
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      cookies: { refresh_token: 'stale' },
    })

    expect(response.statusCode).toBe(401)
  })

  it('revokes the session when an already rotated token comes back', async () => {
    prismaMock.userSession.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        where.previousRefreshTokenHash === hashRefreshToken('copied-token')
          ? {
              id: sessionId,
              userId,
              refreshTokenHash: 'current-hash',
              previousRefreshTokenHash: hashRefreshToken('copied-token'),
              refreshTokenRotatedAt: new Date(Date.now() - 60 * 60 * 1000),
              expiresAt: new Date('2027-01-01T00:00:00.000Z'),
              revokedAt: null,
            }
          : null,
    )
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      cookies: { refresh_token: 'copied-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.userSession.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('rotates the token and returns a fresh 15-minute access token', async () => {
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
      refreshTokenHash: 'new-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: null,
    })
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      cookies: { refresh_token: 'valid-token' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ token: expect.any(String) })
    const sessionCookie = response.cookies.find(
      (cookie) => cookie.name === 'refresh_token',
    )
    expect(sessionCookie).toMatchObject({ httpOnly: true, path: '/sessions' })
    expect(sessionCookie?.value).not.toBe('valid-token')
    expect(prismaMock.userSession.update).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        refreshTokenHash: expect.any(String),
        revokedAt: null,
      },
      // O token que chegou vira o anterior: se voltar depois, é cópia.
      data: {
        refreshTokenHash: expect.any(String),
        previousRefreshTokenHash: hashRefreshToken('valid-token'),
        refreshTokenRotatedAt: expect.any(Date),
      },
    })
  })

  it('returns 401 when another request rotated the token first', async () => {
    prismaMock.userSession.findUnique.mockResolvedValue({
      id: sessionId,
      userId,
      refreshTokenHash: 'any-hash',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      revokedAt: null,
    })
    // O `update` filtra pelo hash lido: se outra requisição já trocou, o
    // Prisma não acha a linha (P2025).
    prismaMock.userSession.update.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    )
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      cookies: { refresh_token: 'raced-token' },
    })

    expect(response.statusCode).toBe(401)
  })

  // `SameSite=Strict` não separa subdomínios: outro app do mesmo domínio raiz
  // mandaria o cookie numa requisição forjada. O `Origin` separa.
  it('returns 401 for a request from another origin', async () => {
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
      headers: { origin: 'https://outro-app.example.com' },
      cookies: { refresh_token: 'valid-token' },
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.userSession.findUnique).not.toHaveBeenCalled()
  })

  it('returns 401 without the refresh token cookie', async () => {
    const app = await buildTestApp(refreshSession)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/refresh',
    })

    expect(response.statusCode).toBe(401)
    expect(prismaMock.userSession.findUnique).not.toHaveBeenCalled()
  })
})
