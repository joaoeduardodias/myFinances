import { env } from '@myfinances/env'
import type { FastifyReply, FastifyRequest } from 'fastify'

import { isAllowedOrigin } from '@/http/cors'

import { UnauthorizedError } from '../_errors/unauthorized-error'

/**
 * O refresh token da sessão web mora num cookie `httpOnly` emitido pela API:
 * o JavaScript da página não o lê, então um XSS leva no máximo o access token
 * de 15 minutos, não a sessão de 30 dias. Só funciona porque `app.` e `api.`
 * ficam sob o mesmo domínio raiz: o cookie é first-party e `SameSite=Strict`
 * ainda o envia nas chamadas do app.
 *
 * O access token continua no header `Authorization`, então as rotas de dado
 * seguem imunes a CSRF. Só as duas rotas abaixo de `/sessions` que leem este
 * cookie (refresh e logout) precisam de `assertTrustedOrigin`.
 */
export const SESSION_COOKIE = 'refresh_token'
const SESSION_COOKIE_PATH = '/sessions'

// Em dev o app roda em http://localhost; lá o navegador recusaria `Secure`.
const secure = () => new URL(env.WEB_URL).protocol === 'https:'

export function setSessionCookie(
  reply: FastifyReply,
  refreshToken: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, refreshToken, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'strict',
    path: SESSION_COOKIE_PATH,
    expires: expiresAt,
  })
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'strict',
    path: SESSION_COOKIE_PATH,
  })
}

export function readSessionCookie(request: FastifyRequest) {
  return request.cookies[SESSION_COOKIE]
}

/**
 * `SameSite=Strict` não separa subdomínios: outro app da empresa é o mesmo
 * site e o navegador mandaria o cookie numa requisição forjada por ele. O
 * `Origin`, que o navegador sempre põe num POST de outra origem, separa.
 */
export function assertTrustedOrigin(request: FastifyRequest) {
  if (!isAllowedOrigin(request.headers.origin, env.WEB_URL)) {
    throw new UnauthorizedError('Origem não autorizada.')
  }
}
