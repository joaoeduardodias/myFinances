import { describe, expect, it } from 'vitest'

import {
  generateRefreshToken,
  hashRefreshToken,
  rotateSession,
  type RotatingSessionStore,
} from './rotating-session-token'

interface FakeSession {
  id: string
  expiresAt: Date
  revokedAt: Date | null
  refreshTokenHash: string
  previousRefreshTokenHash?: string | null
  refreshTokenRotatedAt?: Date | null
}

class InMemoryStore implements RotatingSessionStore<FakeSession> {
  private sessions = new Map<string, FakeSession>()

  seed(session: FakeSession) {
    this.sessions.set(session.id, session)
  }

  async findByRefreshTokenHash(refreshTokenHash: string) {
    return (
      [...this.sessions.values()].find(
        (s) => s.refreshTokenHash === refreshTokenHash,
      ) ?? null
    )
  }

  async findByPreviousRefreshTokenHash(previousRefreshTokenHash: string) {
    return (
      [...this.sessions.values()].find(
        (s) => s.previousRefreshTokenHash === previousRefreshTokenHash,
      ) ?? null
    )
  }

  // Compare-and-swap, como o store de verdade: só grava se o hash ainda é o
  // que o chamador leu.
  async updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string,
    currentRefreshTokenHash: string,
    rotatedAt: Date,
  ) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('missing')
    if (session.refreshTokenHash !== currentRefreshTokenHash) return null
    session.previousRefreshTokenHash = currentRefreshTokenHash
    session.refreshTokenRotatedAt = rotatedAt
    session.refreshTokenHash = refreshTokenHash
    return session
  }

  async revokeReused(id: string, revokedAt: Date) {
    const session = this.sessions.get(id)
    if (session) session.revokedAt = revokedAt
  }
}

class FakeSessionError extends Error {}

const messages = {
  invalid: 'Invalid token.',
  revoked: 'Revoked.',
  expired: 'Expired.',
}

describe('rotateSession', () => {
  it('generates a unique token on every call', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('hashes the same token to the same value', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'))
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'))
  })

  it('rotates a valid session and makes the old token unusable', async () => {
    const store = new InMemoryStore()
    const token = 'raw-token'
    store.seed({
      id: 's1',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: null,
      refreshTokenHash: hashRefreshToken(token),
    })
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    const result = await rotateSession(store, token, now, messages, FakeSessionError)

    expect(result.refreshToken).not.toBe(token)
    await expect(
      rotateSession(store, token, now, messages, FakeSessionError),
    ).rejects.toThrow('Invalid token.')
  })

  it('refuses an unknown token', async () => {
    const store = new InMemoryStore()
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    await expect(
      rotateSession(store, 'never-issued', now, messages, FakeSessionError),
    ).rejects.toThrow('Invalid token.')
  })

  it('refuses a revoked session', async () => {
    const store = new InMemoryStore()
    const token = 'raw-token'
    store.seed({
      id: 's1',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: new Date('2026-09-30T00:00:00.000Z'),
      refreshTokenHash: hashRefreshToken(token),
    })
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    await expect(
      rotateSession(store, token, now, messages, FakeSessionError),
    ).rejects.toThrow('Revoked.')
  })

  it('refuses a session at or past its expiry', async () => {
    const store = new InMemoryStore()
    const token = 'raw-token'
    store.seed({
      id: 's1',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      revokedAt: null,
      refreshTokenHash: hashRefreshToken(token),
    })
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    await expect(
      rotateSession(store, token, now, messages, FakeSessionError),
    ).rejects.toThrow('Expired.')
  })

  it('throws the given error class', async () => {
    const store = new InMemoryStore()
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    await expect(
      rotateSession(store, 'nope', now, messages, FakeSessionError),
    ).rejects.toBeInstanceOf(FakeSessionError)
  })

  it('lets only one of two concurrent rotations of the same token win', async () => {
    const store = new InMemoryStore()
    const token = 'raw-token'
    store.seed({
      id: 's1',
      expiresAt: new Date('2026-11-01T00:00:00.000Z'),
      revokedAt: null,
      refreshTokenHash: hashRefreshToken(token),
    })
    const now = () => new Date('2026-10-01T00:00:00.000Z')

    const results = await Promise.allSettled([
      rotateSession(store, token, now, messages, FakeSessionError),
      rotateSession(store, token, now, messages, FakeSessionError),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const loser = results.find((r) => r.status === 'rejected')
    expect(loser).toMatchObject({ reason: expect.any(FakeSessionError) })
  })

  describe('a rotated token coming back', () => {
    const t0 = new Date('2026-10-01T00:00:00.000Z')
    const at = (seconds: number) => () => new Date(t0.getTime() + seconds * 1000)

    async function rotatedOnce() {
      const store = new InMemoryStore()
      const oldToken = 'raw-token'
      store.seed({
        id: 's1',
        expiresAt: new Date('2026-11-01T00:00:00.000Z'),
        revokedAt: null,
        refreshTokenHash: hashRefreshToken(oldToken),
      })
      const { refreshToken: newToken } = await rotateSession(
        store, oldToken, at(0), messages, FakeSessionError,
      )
      return { store, oldToken, newToken }
    }

    // Quem guarda um token velho depois da rotação ou é o ladrão, ou é a
    // vítima — e o ladrão já está com o novo. Matar a sessão corta os dois.
    it('revokes the whole session after the grace window', async () => {
      const { store, oldToken, newToken } = await rotatedOnce()

      await expect(
        rotateSession(store, oldToken, at(300), messages, FakeSessionError),
      ).rejects.toThrow('Revoked.')
      await expect(
        rotateSession(store, newToken, at(301), messages, FakeSessionError),
      ).rejects.toThrow('Revoked.')
    })

    // Duas abas: a segunda manda o token que a primeira acabou de trocar.
    it('only refuses it right after the rotation, keeping the session', async () => {
      const { store, oldToken, newToken } = await rotatedOnce()

      await expect(
        rotateSession(store, oldToken, at(10), messages, FakeSessionError),
      ).rejects.toThrow('Invalid token.')
      await expect(
        rotateSession(store, newToken, at(11), messages, FakeSessionError),
      ).resolves.toMatchObject({ refreshToken: expect.any(String) })
    })
  })
})
