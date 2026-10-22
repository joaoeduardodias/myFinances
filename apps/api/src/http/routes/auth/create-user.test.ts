import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestApp, makePrismaMock, uuid } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { createUser } = await import('./create-user')

describe('POST /users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 409 when email already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'existing' })
    const app = await buildTestApp(createUser)

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'John', email: 'a@b.com', password: 'secret123' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toMatch(/já existe/i)
  })

  it('refuses a password shorter than eight characters', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(createUser)

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'Ana', email: 'ana@test.com', password: 'sete123' },
    })

    expect(response.statusCode).toBe(400)
    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('returns 201 with a signed token and creates the user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    prismaMock.user.create.mockResolvedValue({ id: uuid('user') })
    prismaMock.userSession.create.mockResolvedValue({
      id: uuid('session'),
      userId: uuid('user'),
      refreshTokenHash: 'hash',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: null,
    })
    const app = await buildTestApp(createUser)
    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: 'John', email: 'a@b.com', password: 'secret123' },
    })
    expect(response.statusCode).toBe(201)
    expect(typeof response.json().token).toBe('string')
    expect(response.json().token.length).toBeGreaterThan(0)
    const sessionCookie = response.cookies.find(
      (cookie) => cookie.name === 'refresh_token',
    )
    expect(sessionCookie?.value).toEqual(expect.any(String))
    expect(response.json()).not.toHaveProperty('refreshToken')
    const data = prismaMock.user.create.mock.calls[0][0].data
    expect(data.passwordHash).not.toBe('secret123')
  })

  it('returns 400 on invalid payload', async () => {
    const app = await buildTestApp(createUser)
    const response = await app.inject({
      method: 'POST',
      url: '/users',
      payload: { name: '', email: 'not-email', password: '1' },
    })
    expect(response.statusCode).toBe(400)
  })
})
