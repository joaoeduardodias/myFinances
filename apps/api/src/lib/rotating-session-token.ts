import { createHash, randomBytes } from 'node:crypto'

const REFRESH_TOKEN_BYTES = 32

/**
 * Quanto tempo depois da rotação o token anterior ainda volta sem alarme: duas
 * abas renovando juntas (ver `http/api.ts` do web) mandam o token que a outra
 * acabou de trocar. Depois disso, token velho de volta é sinal de cópia.
 */
const ROTATION_GRACE_MS = 30 * 1000

export interface RotatingSession {
  id: string
  expiresAt: Date
  revokedAt: Date | null
  refreshTokenRotatedAt?: Date | null
}

export interface RotatingSessionStore<TSession extends RotatingSession> {
  findByRefreshTokenHash(refreshTokenHash: string): Promise<TSession | null>
  /** A sessão cujo token imediatamente anterior tinha este hash. */
  findByPreviousRefreshTokenHash(
    previousRefreshTokenHash: string,
  ): Promise<TSession | null>
  /**
   * Compare-and-swap: só grava se a sessão ainda guarda `currentRefreshTokenHash`
   * e não foi revogada. Devolve `null` quando outra requisição rotacionou (ou
   * revogou) entre a leitura e a escrita. Guarda `currentRefreshTokenHash` como
   * o anterior e `rotatedAt`, para reconhecer o token velho se ele voltar.
   */
  updateRefreshTokenHash(
    id: string,
    refreshTokenHash: string,
    currentRefreshTokenHash: string,
    rotatedAt: Date,
  ): Promise<TSession | null>
  revokeReused(id: string, revokedAt: Date): Promise<void>
}

export interface RotateSessionMessages {
  invalid: string
  revoked: string
  expired: string
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function generateRefreshToken() {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
}

/**
 * Valida e rotaciona um refresh token contra qualquer store que siga a forma
 * mínima de `RotatingSession`. Gerar, hashear e rotacionar é a mesma conta
 * sensível a segurança pro desktop e pra sessão web — um lugar só pra não
 * divergir.
 */
export async function rotateSession<TSession extends RotatingSession>(
  store: RotatingSessionStore<TSession>,
  refreshToken: string,
  now: () => Date,
  messages: RotateSessionMessages,
  ErrorClass: new (message: string) => Error,
): Promise<{ session: TSession; refreshToken: string }> {
  const currentRefreshTokenHash = hashRefreshToken(refreshToken)
  const session = await store.findByRefreshTokenHash(currentRefreshTokenHash)
  if (!session) {
    const reused = await revokeIfReused(store, currentRefreshTokenHash, now())
    throw new ErrorClass(reused ? messages.revoked : messages.invalid)
  }
  if (session.revokedAt) {
    throw new ErrorClass(messages.revoked)
  }
  if (session.expiresAt <= now()) {
    throw new ErrorClass(messages.expired)
  }

  const nextRefreshToken = generateRefreshToken()
  const updatedSession = await store.updateRefreshTokenHash(
    session.id,
    hashRefreshToken(nextRefreshToken),
    currentRefreshTokenHash,
    now(),
  )
  // Perdeu a corrida: o token que chegou já foi trocado por outra requisição.
  if (!updatedSession) {
    throw new ErrorClass(messages.invalid)
  }
  return { session: updatedSession, refreshToken: nextRefreshToken }
}

/**
 * Token já rotacionado voltando: quem o guarda é o ladrão ou a vítima, e o
 * outro já tem o novo. Revogar a sessão corta os dois — a vítima entra de
 * novo com a senha, o ladrão não. Dentro da janela da rotação é só outra aba.
 */
async function revokeIfReused<TSession extends RotatingSession>(
  store: RotatingSessionStore<TSession>,
  refreshTokenHash: string,
  now: Date,
) {
  const session = await store.findByPreviousRefreshTokenHash(refreshTokenHash)
  if (!session || session.revokedAt) return false
  const rotatedAt = session.refreshTokenRotatedAt
  if (rotatedAt && now.getTime() - rotatedAt.getTime() <= ROTATION_GRACE_MS) {
    return false
  }
  await store.revokeReused(session.id, now)
  return true
}
