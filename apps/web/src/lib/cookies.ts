import Cookies from 'js-cookie'

const TOKEN_KEY = 'token'
// Até out/2026 o refresh token morava aqui, legível por JavaScript. Hoje ele é
// um cookie `httpOnly` da API (`routes/auth/session-cookie.ts`); o antigo sai
// em todo login, renovação e fim de sessão, para não sobrar um segredo válido
// ao alcance de um XSS.
const LEGACY_REFRESH_TOKEN_KEY = 'refresh_token'

// O access token (15 minutos) continua legível por JavaScript de propósito:
// `http/api.ts` o lê a cada requisição para montar o header `Authorization`,
// o que deixa as rotas de dado imunes a CSRF. Quem guarda a sessão de 30 dias
// é o refresh token, no cookie `httpOnly` da API. Este cookie dura os mesmos
// 30 dias porque também é a marca de que há sessão: vencido o JWT, o primeiro
// 401 renova pelo cookie da API (ver http/api.ts).
//
// `secure` condicionado ao protocolo da aba, e não a `import.meta.env.PROD`:
// em `http://localhost` o navegador recusaria um cookie `secure` e o
// desenvolvimento pararia calado. Função e não constante de módulo porque
// avaliar no import fixaria o valor para sempre.
const accessTokenCookieOptions = (): Cookies.CookieAttributes => ({
  sameSite: 'lax',
  secure: window.location.protocol === 'https:',
  expires: 30,
})

export const getToken = () => Cookies.get(TOKEN_KEY)
export const setToken = (t: string) => {
  Cookies.remove(LEGACY_REFRESH_TOKEN_KEY)
  Cookies.set(TOKEN_KEY, t, accessTokenCookieOptions())
}
export const clearToken = () => {
  Cookies.remove(LEGACY_REFRESH_TOKEN_KEY)
  Cookies.remove(TOKEN_KEY)
}

export const hasSession = () => Boolean(getToken())
