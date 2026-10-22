import bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestApp, makePrismaMock } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { authenticateWithPassword } = await import('./authenticate-with-password')

describe('POST /sessions/password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when user is not found', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(authenticateWithPassword)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'unknown@test.com', password: 'secret123' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ message: 'E-mail ou senha incorretos.' })
  })

  it('lets a legacy password shorter than the new minimum reach the check', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: await bcrypt.hash('old123', 6),
    })
    prismaMock.userSession.create.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'hash',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: null,
    })
    const app = await buildTestApp(authenticateWithPassword)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'a@b.com', password: 'old123' },
    })

    // O mínimo novo vale para quem *define* senha. Aplicá-lo no login trancaria
    // para fora todo mundo que já tem uma senha de 6 caracteres.
    expect(response.statusCode).toBe(201)
  })

  it('returns 400 when password is incorrect', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: await bcrypt.hash('correct-password', 6),
    })
    const app = await buildTestApp(authenticateWithPassword)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'a@b.com', password: 'wrong-password' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ message: 'E-mail ou senha incorretos.' })
  })

  it('returns 201 with token on valid credentials', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: await bcrypt.hash('correct-password', 6),
    })
    prismaMock.userSession.create.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'hash',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: null,
    })
    const app = await buildTestApp(authenticateWithPassword)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'a@b.com', password: 'correct-password' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().token).toEqual(expect.any(String))
    // O refresh token vai só no cookie `httpOnly`: o JavaScript da página
    // não o lê, então um XSS não leva a sessão de 30 dias.
    expect(response.json()).not.toHaveProperty('refreshToken')
    expect(
      response.cookies.find((cookie) => cookie.name === 'refresh_token'),
    ).toMatchObject({
      value: expect.any(String),
      httpOnly: true,
      sameSite: 'Strict',
      path: '/sessions',
      expires: expect.any(Date),
    })
  })

  it('returns 400 when body is invalid', async () => {
    const app = await buildTestApp(authenticateWithPassword)

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'not-an-email', password: '123' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('looks the account up by the lowercased e-mail', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(authenticateWithPassword)

    await app.inject({
      method: 'POST',
      url: '/sessions/password',
      payload: { email: 'Diego@Exemplo.com.br', password: 'secret123' },
    })

    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({
      email: 'diego@exemplo.com.br',
    })
  })
})
