/**
 * Decide se uma origem pode falar com a API.
 *
 * Comparação por `URL.origin`, e não por texto: `origin` normaliza esquema,
 * host e porta e descarta path, então `startsWith`/`endsWith` — que deixariam
 * passar `myfinances.example.com.evil.com` e `evilmyfinances.example.com` —
 * ficam fora de questão. O esquema entra na conta de propósito: o mesmo host
 * em http é outra origem, e aceitá-lo reabriria a porta que o cookie de
 * sessão só-HTTPS fechou.
 */
export function isAllowedOrigin(origin: string | undefined, appUrl: string) {
  // Sem cabeçalho `Origin` não há navegador do outro lado: webhook do Pluggy,
  // healthcheck, curl. O CORS não governa esses, e recusar aqui derrubaria o
  // webhook sem proteger nada.
  if (!origin) return true

  try {
    return new URL(origin).origin === new URL(appUrl).origin
  } catch {
    return false
  }
}
