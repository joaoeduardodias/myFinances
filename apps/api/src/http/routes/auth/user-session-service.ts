import {
  generateRefreshToken,
  hashRefreshToken,
  rotateSession,
} from '@/lib/rotating-session-token'

const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

export interface UserSession {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: Date
  revokedAt: Date | null
}

export interface UserSessionStore {
  create(input: {
    userId: string
    refreshTokenHash: string
    expiresAt: Date
  }): Promise<UserSession>
  findByRefreshTokenHash(refreshTokenHash: string): Promise<UserSession | null>
  findByPreviousRefreshTokenHash(
    previousRefreshTokenHash: string,
  ): Promise<UserSession | null>
  revokeReused(id: string, revokedAt: Date): Promise<void>
  updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string,
    currentRefreshTokenHash: string,
    rotatedAt: Date,
  ): Promise<UserSession | null>
  revoke(id: string, revokedAt: Date): Promise<UserSession>
  revokeAllForUser(userId: string, revokedAt: Date): Promise<void>
}

export class UserSessionError extends Error {}

const MESSAGES = {
  invalid: 'Sessão expirada. Entre novamente.',
  revoked: 'Sessão revogada. Entre novamente.',
  expired: 'Sessão expirada. Entre novamente.',
}

export function createUserSessionService(
  store: UserSessionStore,
  now: () => Date = () => new Date(),
) {
  return {
    async create(input: { userId: string }) {
      const refreshToken = generateRefreshToken()
      const session = await store.create({
        userId: input.userId,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(now().getTime() + REFRESH_TOKEN_LIFETIME_MS),
      })
      return { session, refreshToken }
    },

    refresh(refreshToken: string) {
      return rotateSession(store, refreshToken, now, MESSAGES, UserSessionError)
    },

    async logout(refreshToken: string) {
      const session = await store.findByRefreshTokenHash(
        hashRefreshToken(refreshToken),
      )
      // Idempotente: token desconhecido, já revogado ou vencido já é uma sessão
      // morta, que é tudo que o logout quer. Errar aqui só faria o cliente
      // tentar renovar a sessão que está encerrando.
      if (!session || session.revokedAt || session.expiresAt <= now()) return
      await store.revoke(session.id, now())
    },

    revokeAll(userId: string) {
      return store.revokeAllForUser(userId, now())
    },
  }
}
