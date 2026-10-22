import { describe, expect, it, vi } from 'vitest'

// Avoid constructing the real Prisma client (and its pg adapter) on import.
vi.mock('@/lib/prisma', () => ({ prisma: { $executeRaw: vi.fn() } }))

const { checkDatabaseConnection } = await import('./check-database-connection')

describe('checkDatabaseConnection', () => {
  it('resolves when the database answers the probe query', async () => {
    const client = { $executeRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) }

    await expect(checkDatabaseConnection(client)).resolves.toBeUndefined()
    expect(client.$executeRaw).toHaveBeenCalledOnce()
  })

  it('throws a friendly, actionable error when the database is unreachable', async () => {
    const client = {
      $executeRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }

    await expect(checkDatabaseConnection(client)).rejects.toThrow(
      /não foi possível conectar ao banco/i,
    )
  })

  it('names the host/port/database but never leaks credentials', async () => {
    const client = {
      $executeRaw: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }

    // Derive expectations from whatever DATABASE_URL is active (setup default
    // or the real .env loaded via env:load) so the test is environment-stable.
    const { env } = await import('@myfinances/env')
    const url = new URL(env.DATABASE_URL)

    let error: Error | undefined
    await checkDatabaseConnection(client).catch((e) => {
      error = e as Error
    })

    expect(error).toBeDefined()
    // Names host:port and database…
    expect(error?.message).toContain(url.host)
    expect(error?.message).toContain(url.pathname)
    // …but never the credentials (the `user:password` userinfo pair).
    expect(error?.message).not.toContain(`${url.username}:${url.password}`)
    expect(error?.message).toMatch(/docker compose up -d/)
  })

  it('diz o motivo real da recusa, não só que falhou', async () => {
    // "senha recusada" e "banco não existe" pedem conserto diferente de
    // "Postgres não está rodando", e quem lê o log do boot não abre a `cause`.
    const client = {
      $executeRaw: vi
        .fn()
        .mockRejectedValue(
          new Error('password authentication failed for user "docker"'),
        ),
    }

    let error: Error | undefined
    await checkDatabaseConnection(client).catch((e) => {
      error = e as Error
    })

    expect(error?.message).toMatch(/password authentication failed/)
  })

  it('apaga a credencial quando ela vem dentro do motivo', async () => {
    const client = {
      $executeRaw: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Cannot reach postgresql://dono:senha@db.exemplo.com:5432/fazenda',
          ),
        ),
    }

    let error: Error | undefined
    await checkDatabaseConnection(client).catch((e) => {
      error = e as Error
    })

    expect(error?.message).not.toMatch(/senha@/)
    expect(error?.message).toMatch(/\[conexão\]/)
  })
})
