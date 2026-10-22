import type { PluggyItem } from './types'

/** Como o erro do item fica em `lastError`: o código vem junto, é por ele que se traduz. */
export function itemErrorText(error: PluggyItem['error']): string | null {
  return error ? `${error.code}: ${error.message}` : null
}

export const PLUGGY_AUTH_ERROR_MESSAGE = 'A Pluggy recusou o acesso — reautorize no Meu Pluggy.'
export const PLUGGY_GENERIC_ERROR_MESSAGE = 'Falha ao falar com a Pluggy. Tente de novo mais tarde.'

// Códigos do item que pedem nova autorização do usuário, e recusa (401/403)
// numa chamada da Pluggy. "na autenticação" é a nossa chave de API, não o
// consentimento do usuário, e fica com a mensagem genérica.
const AUTH_ERROR =
  /\b(LOGIN_ERROR|USER_AUTHORIZATION_EXPIRED|USER_AUTHORIZATION_NOT_GRANTED|INVALID_CREDENTIALS)\b|\bPluggy 40[13] em\b/

/**
 * `lastError` guarda o texto cru (em inglês, da Pluggy) para diagnóstico; o
 * que sai pela API é esta frase em português.
 */
export function friendlyConnectionError(raw: string | null): string | null {
  if (!raw) return null
  return AUTH_ERROR.test(raw) ? PLUGGY_AUTH_ERROR_MESSAGE : PLUGGY_GENERIC_ERROR_MESSAGE
}
