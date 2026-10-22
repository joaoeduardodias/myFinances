import { describe, expect, it } from 'vitest'

import {
  createUserSessionService,
  type UserSession,
  UserSessionError,
  type UserSessionStore,
} from './user-session-service'

class InMemoryUserSessionStore implements UserSessionStore {
  sessions = new Map<string, UserSession>()
  private nextId = 0

  async create(input: {
    userId: string
    refreshTokenHash: string
    expiresAt: Date
  }) {
    const session: UserSession = {
      id: `session-${this.nextId++}`,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    }
    this.sessions.set(session.id, session)
    return session
  }

  async findByRefreshTokenHash(refreshTokenHash: string) {
    return (
      [...this.sessions.values()].find(
        (s) => s.refreshTokenHash === refreshTokenHash,
      ) ?? null
    )
  }

  async updateRefreshTokenHash(id: string, refreshTokenHash: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('missing')
    session.refreshTokenHash = refreshTokenHash
    return session
  }

  // A detecção de reuso é testada em `rotating-session-token.test.ts`.
  async findByPreviousRefreshTokenHash() {
    return null
  }

  async revokeReused() {}

  async revoke(id: string, revokedAt: Date) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('missing')
    session.revokedAt = revokedAt
    return session
  }

  async revokeAllForUser(userId: string, revokedAt: Date) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = revokedAt
      }
    }
  }
}

const userId = '11111111-1111-4111-8111-000000000001'
const otherUserId = '11111111-1111-4111-8111-000000000002'
const now = () => new Date('2026-10-01T12:00:00.000Z')

describe('user session service', () => {
  it('creates a session with a 30-day expiry', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)

    const issued = await service.create({ userId })

    expect(issued.session.userId).toBe(userId)
    expect(issued.session.expiresAt.toISOString()).toBe(
      '2026-10-31T12:00:00.000Z',
    )
    expect(typeof issued.refreshToken).toBe('string')
  })

  it('rotates on refresh and rejects the old token afterwards', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)
    const issued = await service.create({ userId })

    const refreshed = await service.refresh(issued.refreshToken)

    expect(refreshed.refreshToken).not.toBe(issued.refreshToken)
    await expect(service.refresh(issued.refreshToken)).rejects.toThrow(
      'Sessão expirada. Entre novamente.',
    )
    await expect(service.refresh(issued.refreshToken)).rejects.toBeInstanceOf(
      UserSessionError,
    )
  })

  it('rejects refreshing a revoked session', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)
    const issued = await service.create({ userId })

    await service.logout(issued.refreshToken)

    await expect(service.refresh(issued.refreshToken)).rejects.toThrow(
      'Session has been revoked.',
    )
  })

  it('logs out a live session', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)
    const issued = await service.create({ userId })

    await service.logout(issued.refreshToken)

    expect(store.sessions.get(issued.session.id)?.revokedAt).toEqual(now())
  })

  // Logout é idempotente: o objetivo (sessão morta) já foi atingido, e um erro
  // aqui só faria o cliente tentar renovar uma sessão que ele quer encerrar.
  it('succeeds quietly for an unknown token', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)

    await expect(service.logout('never-issued')).resolves.toBeUndefined()
  })

  it('succeeds quietly for an already-revoked token and keeps the first revocation time', async () => {
    const store = new InMemoryUserSessionStore()
    const firstRevocation = new Date('2026-10-01T11:00:00.000Z')
    const service = createUserSessionService(store, now)
    const issued = await service.create({ userId })
    store.sessions.get(issued.session.id)!.revokedAt = firstRevocation

    await expect(service.logout(issued.refreshToken)).resolves.toBeUndefined()

    expect(store.sessions.get(issued.session.id)?.revokedAt).toEqual(
      firstRevocation,
    )
  })

  it('revokes every session for a user, leaving other users untouched', async () => {
    const store = new InMemoryUserSessionStore()
    const service = createUserSessionService(store, now)
    const mine1 = await service.create({ userId })
    const mine2 = await service.create({ userId })
    const theirs = await service.create({ userId: otherUserId })

    await service.revokeAll(userId)

    expect(store.sessions.get(mine1.session.id)?.revokedAt).toEqual(now())
    expect(store.sessions.get(mine2.session.id)?.revokedAt).toEqual(now())
    expect(store.sessions.get(theirs.session.id)?.revokedAt).toBeNull()
  })
})
