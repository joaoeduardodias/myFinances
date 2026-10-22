import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestApp, makePrismaMock } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { rateLimiter } = await import('./rate-limit')
const { authenticateWithPassword } = await import(
  '../routes/auth/authenticate-with-password'
)
const { createUser } = await import('../routes/auth/create-user')

async function attemptLogin(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  email: string,
) {
  return app.inject({
    method: 'POST',
    url: '/sessions/password',
    payload: { email, password: 'whatever-8' },
  })
}

describe('rate limiter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Usuário inexistente: a rota recusa em 400 sem tocar no bcrypt, então o
    // teste mede o limitador e não o custo do hash.
    prismaMock.user.findUnique.mockResolvedValue(null)
  })

  it('answers 429 once the login attempts for one e-mail run out', async () => {
    const app = await buildTestApp(rateLimiter, authenticateWithPassword)

    for (let attempt = 0; attempt < 10; attempt++) {
      const allowed = await attemptLogin(app, 'target@test.com')
      expect(allowed.statusCode).toBe(400)
    }

    const blocked = await attemptLogin(app, 'target@test.com')

    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().message).toMatch(/tentativas/i)
  })

  it('counts login attempts per e-mail, not for the whole route', async () => {
    const app = await buildTestApp(rateLimiter, authenticateWithPassword)

    for (let attempt = 0; attempt < 10; attempt++) {
      await attemptLogin(app, 'exhausted@test.com')
    }
    expect((await attemptLogin(app, 'exhausted@test.com')).statusCode).toBe(429)

    // Outra conta não herda o balde da primeira: senão bastaria queimar as
    // tentativas de um e-mail qualquer para trancar todas as contas.
    const other = await attemptLogin(app, 'someone-else@test.com')

    expect(other.statusCode).toBe(400)
  })

  it('answers 429 once the sign-ups from one address run out', async () => {
    // Cadastro é limitado por IP, e não por e-mail: um e-mail novo a cada
    // tentativa faria um limite por e-mail nunca disparar.
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u', email: 'x' })
    const app = await buildTestApp(rateLimiter, createUser)

    const signUp = (email: string) =>
      app.inject({
        method: 'POST',
        url: '/users',
        payload: { name: 'Ana', email, password: 'senha1234' },
      })

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await signUp(`novo-${attempt}@test.com`)).statusCode).toBe(409)
    }

    expect((await signUp('mais-um@test.com')).statusCode).toBe(429)
  })
})
