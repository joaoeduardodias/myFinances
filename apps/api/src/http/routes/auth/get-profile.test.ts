import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { getProfile } = await import('./get-profile')

describe('GET /profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no token is provided', async () => {
    const app = await buildTestApp(getProfile)
    const response = await app.inject({ method: 'GET', url: '/profile' })
    expect(response.statusCode).toBe(401)
  })

  it('returns 500 when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const app = await buildTestApp(getProfile)
    const token = await signToken(app, { sub: 'user-1' })

    const response = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: authHeaders(token),
    })

    expect(response.statusCode).toBe(500)
  })

  it('returns only id, name and email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: uuid('user'),
      name: 'Jane',
      email: 'jane@test.com',
    })
    const app = await buildTestApp(getProfile)
    const token = await signToken(app, { sub: uuid('user') })

    const response = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: authHeaders(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      user: { id: uuid('user'), name: 'Jane', email: 'jane@test.com' },
    })
    expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({
      id: uuid('user'),
    })
  })
})
