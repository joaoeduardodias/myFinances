import { clearToken } from '@/lib/cookies'

/**
 * Sessão sem conserto — access token e refresh token mortos no servidor, ou nunca
 * existiram. `auth-context.tsx` usa isto no 401 do boot inicial; `api.ts`
 * usa o mesmo quando a renovação silenciosa falha. Um módulo à parte dos
 * dois pra nenhum importar o outro.
 */
export function endSession() {
  clearToken()
  window.location.href = '/login'
}
