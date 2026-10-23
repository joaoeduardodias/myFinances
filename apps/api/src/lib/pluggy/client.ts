import { env } from '@myfinances/env'

import type { IsoDate } from '@/lib/today'

import type {
  PluggyAccount,
  PluggyBill,
  PluggyItem,
  PluggyTransaction,
} from './types'

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'PluggyError'
  }
}

export class PluggyNotFoundError extends PluggyError {
  constructor(path: string) {
    super(`Pluggy 404 em ${path}`, 404)
    this.name = 'PluggyNotFoundError'
  }
}

// A API key vale 2 h; renovamos antes para não usar uma que expira no meio
// de uma sincronização.
const API_KEY_TTL_MS = 100 * 60 * 1000

type Paged<T> = { results: T[]; page?: number; totalPages?: number }
type Cursor<T> = { results: T[]; next?: string | null }

export type PluggyClient = {
  getItem(itemId: string): Promise<PluggyItem>
  listAccounts(itemId: string): Promise<PluggyAccount[]>
  listTransactions(accountId: string, dateFrom: IsoDate): Promise<PluggyTransaction[]>
  listBills(accountId: string): Promise<PluggyBill[]>
  /** Cadastra o webhook de todos os eventos; `headers` voltam em cada chamada. */
  registerWebhook(url: string, headers: Record<string, string>): Promise<void>
  /** Token curto para o widget Pluggy Connect abrir no navegador. */
  createConnectToken(clientUserId: string): Promise<string>
}

export function createPluggyClient(opts: {
  baseUrl: string
  clientId: string
  clientSecret: string
  fetch?: typeof fetch
  now?: () => number
}): PluggyClient {
  const doFetch = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  let cached: { apiKey: string; expiresAt: number } | null = null

  async function readError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '')
    try {
      const body = JSON.parse(text) as { message?: string }
      return body.message ?? text
    } catch {
      return text
    }
  }

  async function apiKey(): Promise<string> {
    if (cached && now() < cached.expiresAt) return cached.apiKey
    const response = await doFetch(new URL('/auth', opts.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      }),
    })
    if (!response.ok) {
      throw new PluggyError(
        `Pluggy ${response.status} na autenticação: ${await readError(response)}`,
        response.status,
      )
    }
    const { apiKey } = (await response.json()) as { apiKey: string }
    cached = { apiKey, expiresAt: now() + API_KEY_TTL_MS }
    return apiKey
  }

  async function get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, opts.baseUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await doFetch(url, {
      method: 'GET',
      headers: { 'X-API-KEY': await apiKey() },
    })
    if (response.status === 404) throw new PluggyNotFoundError(path)
    if (!response.ok) {
      throw new PluggyError(
        `Pluggy ${response.status} em ${path}: ${await readError(response)}`,
        response.status,
      )
    }
    return (await response.json()) as T
  }

  async function getAllPages<T>(path: string, query: Record<string, string>) {
    const results: T[] = []
    let page = 1
    while (true) {
      const body = await get<Paged<T>>(
        path,
        page === 1 ? query : { ...query, page: String(page) },
      )
      results.push(...body.results)
      if (!body.totalPages || page >= body.totalPages) return results
      page += 1
    }
  }

  return {
    getItem: (itemId) => get<PluggyItem>(`/items/${encodeURIComponent(itemId)}`),

    listAccounts: (itemId) => getAllPages<PluggyAccount>('/accounts', { itemId }),

    async listTransactions(accountId, dateFrom) {
      const query = { accountId, dateFrom }
      const results: PluggyTransaction[] = []
      const seen = new Set<string>()
      let after: string | null = null
      while (true) {
        const body: Cursor<PluggyTransaction> = await get(
          '/v2/transactions',
          after ? { ...query, after } : query,
        )
        results.push(...body.results)
        const next = nextCursor(body.next)
        if (!next) return results
        // Cursor repetido é laço: melhor falhar do que gravar dados pela metade.
        if (seen.has(next)) {
          throw new PluggyError(`Pluggy repetiu o cursor de transações da conta ${accountId}`)
        }
        seen.add(next)
        after = next
      }
    },

    listBills: (accountId) => getAllPages<PluggyBill>('/bills', { accountId }),

    async createConnectToken(clientUserId) {
      const response = await doFetch(new URL('/connect_token', opts.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey() },
        body: JSON.stringify({ options: { clientUserId } }),
      })
      if (!response.ok) {
        throw new PluggyError(
          `Pluggy ${response.status} em /connect_token: ${await readError(response)}`,
          response.status,
        )
      }
      const { accessToken } = (await response.json()) as { accessToken: string }
      return accessToken
    },

    async registerWebhook(url, headers) {
      const response = await doFetch(new URL('/webhooks', opts.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey() },
        body: JSON.stringify({ url, event: 'all', headers }),
      })
      if (!response.ok) {
        throw new PluggyError(
          `Pluggy ${response.status} em /webhooks: ${await readError(response)}`,
          response.status,
        )
      }
    },
  }
}

/**
 * O `next` costuma vir como query string pronta (`...&after=<cursor>`). Tiramos
 * só o `after`, já decodificado, para não codificá-lo duas vezes ao remontar a
 * URL; se vier o cursor puro, usamos como está.
 */
function nextCursor(next: string | null | undefined): string | null {
  if (!next) return null
  // Cursor puro pode ser base64 com `=` no fim; só é query string se tiver `after=`.
  if (!/(^|[?&])after=/.test(next)) return next
  return new URLSearchParams(next.replace(/^[^?]*\?/, '')).get('after')
}

export const pluggy = createPluggyClient({
  baseUrl: env.PLUGGY_BASE_URL,
  clientId: env.PLUGGY_CLIENT_ID,
  clientSecret: env.PLUGGY_CLIENT_SECRET,
})
