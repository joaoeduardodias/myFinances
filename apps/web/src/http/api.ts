import ky from 'ky'

import { endSession } from '@/auth/end-session'
import { getToken, setToken } from '@/lib/cookies'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333'

let refreshPromise: Promise<string> | null = null

// Uma promise só, compartilhada: requisições em paralelo que recebem 401 ao
// mesmo tempo (várias `useQuery` na mesma tela) não podem cada uma chamar
// `/sessions/refresh` — cada rotação invalida o refresh token que a próxima
// ainda não sabe que mudou.
function refreshAccessToken() {
  if (!refreshPromise) {
    // O refresh token vai no cookie `httpOnly` da API, que o navegador manda
    // sozinho e a API rotaciona na resposta.
    refreshPromise = ky
      .post(`${API_URL}/sessions/refresh`, { credentials: 'include' })
      .json<{ token: string }>()
      .then(({ token }) => {
        setToken(token)
        return token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

export const api = ky.create({
  prefixUrl: API_URL,
  // Para o navegador guardar o cookie `httpOnly` do refresh token que login devolve, e mandá-lo no logout. Ele só viaja para
  // `/sessions`; o resto da API se autentica pelo header abaixo.
  credentials: 'include',
  hooks: {
    beforeRequest: [
      (request) => {
        const token = getToken()
        if (token) request.headers.set('Authorization', `Bearer ${token}`)
      },
    ],
    afterResponse: [
      async (request, _options, response, state) => {
        const isRefreshCall = new URL(request.url).pathname.endsWith(
          '/sessions/refresh',
        )
        // Só renova quem mandou token: um 401 de requisição sem ele (login,
        // código de recuperação inválido) é erro da própria chamada.
        if (
          response.status === 401 &&
          !isRefreshCall &&
          state.retryCount === 0 &&
          request.headers.has('Authorization')
        ) {
          const tokenBeforeRefresh = getToken()
          try {
            const token = await refreshAccessToken()
            const headers = new Headers(request.headers)
            headers.set('Authorization', `Bearer ${token}`)
            return ky.retry({
              request: new Request(request, { headers }),
              code: 'TOKEN_REFRESHED',
            })
          } catch {
            // Outra aba pode ter renovado primeiro — o cookie já mudou
            // embora esta aba não tenha feito a renovação (ela perdeu a
            // corrida: seu refresh token já tinha sido rotacionado). Usa o
            // que está no cookie antes de desistir da sessão inteira.
            const tokenAfterFailure = getToken()
            if (tokenAfterFailure && tokenAfterFailure !== tokenBeforeRefresh) {
              const headers = new Headers(request.headers)
              headers.set('Authorization', `Bearer ${tokenAfterFailure}`)
              return ky.retry({
                request: new Request(request, { headers }),
                code: 'TOKEN_REFRESHED',
              })
            }
            endSession()
          }
        }

        return response
      },
    ],
  },
})
