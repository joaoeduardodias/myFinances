import { describe, expect, it, vi } from 'vitest'

import { createPluggyClient, PluggyNotFoundError } from './client'

type Route = (url: URL, init: RequestInit) => { status?: number; body: unknown }

function fakeFetch(route: Route) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (url.pathname === '/auth') {
      return new Response(JSON.stringify({ apiKey: 'key-1' }), { status: 200 })
    }
    const { status = 200, body } = route(url, init)
    return new Response(JSON.stringify(body), { status })
  })
}

function setup(route: Route, now = () => 0) {
  const fetch = fakeFetch(route)
  const client = createPluggyClient({
    baseUrl: 'https://api.pluggy.test',
    clientId: 'id',
    clientSecret: 'secret',
    fetch,
    now,
  })
  const authCalls = () =>
    fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/auth')
  return { fetch, client, authCalls }
}

const item = { id: 'item-1', status: 'UPDATED', connector: { name: 'Nubank' } }

describe('createPluggyClient', () => {
  it('autentica uma vez para duas chamadas seguidas', async () => {
    const { client, authCalls } = setup(() => ({ body: item }))

    await client.getItem('item-1')
    await client.getItem('item-1')

    expect(authCalls()).toHaveLength(1)
    expect(authCalls()[0][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(authCalls()[0][1]?.body))).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
    })
  })

  it('autentica de novo depois de 100 minutos', async () => {
    let now = 0
    const { client, authCalls } = setup(
      () => ({ body: item }),
      () => now,
    )

    await client.getItem('item-1')
    now = 100 * 60 * 1000
    await client.getItem('item-1')

    expect(authCalls()).toHaveLength(2)
  })

  it('manda X-API-KEY em toda chamada', async () => {
    const { client, fetch } = setup((url) => {
      if (url.pathname === '/accounts') return { body: { results: [] } }
      return { body: item }
    })

    await client.getItem('item-1')
    await client.listAccounts('item-1')

    const apiCalls = fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).pathname !== '/auth',
    )
    expect(apiCalls).toHaveLength(2)
    for (const [, init] of apiCalls) {
      expect(new Headers(init?.headers).get('X-API-KEY')).toBe('key-1')
    }
  })

  it('listTransactions segue next até null e junta os results', async () => {
    const { client, fetch } = setup((url) => {
      const after = url.searchParams.get('after')
      if (!after) {
        return {
          body: {
            results: [{ id: 't1' }],
            next: 'accountId=acc-1&dateFrom=2026-01-01&after=c%2B1',
          },
        }
      }
      if (after === 'c+1') return { body: { results: [{ id: 't2' }], next: 'c+2' } }
      return { body: { results: [{ id: 't3' }], next: null } }
    })

    const txs = await client.listTransactions('acc-1', '2026-01-01')

    expect(txs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
    const urls = fetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/v2/transactions')
    expect(urls[0].searchParams.get('accountId')).toBe('acc-1')
    expect(urls[0].searchParams.get('dateFrom')).toBe('2026-01-01')
    expect(urls[1].searchParams.get('after')).toBe('c+1')
    expect(urls[2].searchParams.get('after')).toBe('c+2')
    expect(urls[2].searchParams.get('accountId')).toBe('acc-1')
  })

  it('cursor puro em base64 com = no fim segue até o fim', async () => {
    const { client } = setup((url) => {
      const after = url.searchParams.get('after')
      if (!after) return { body: { results: [{ id: 't1' }], next: 'YWJj==' } }
      if (after === 'YWJj==') return { body: { results: [{ id: 't2' }], next: 'ZGVm=' } }
      return { body: { results: [{ id: 't3' }], next: null } }
    })

    const txs = await client.listTransactions('acc-1', '2026-01-01')

    expect(txs.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('cursor em ciclo A → B → A falha em vez de devolver dados pela metade', async () => {
    const { client } = setup((url) => {
      const after = url.searchParams.get('after')
      return { body: { results: [{ id: after ?? 'first' }], next: after === 'A' ? 'B' : 'A' } }
    })

    await expect(client.listTransactions('acc-1', '2026-01-01')).rejects.toThrow(/cursor/)
  })

  it('listAccounts segue as páginas', async () => {
    const { client } = setup((url) => {
      const page = Number(url.searchParams.get('page') ?? 1)
      return { body: { results: [{ id: `a${page}` }], page, totalPages: 2 } }
    })

    const accounts = await client.listAccounts('item-1')

    expect(accounts.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('registerWebhook envia url, event all e headers com a API key', async () => {
    const { client, fetch } = setup(() => ({ body: {} }))
    await client.registerWebhook('https://x.test/webhooks/pluggy', { h: 'v' })
    const [input, init] = fetch.mock.calls.at(-1)!
    expect(new URL(String(input)).pathname).toBe('/webhooks')
    expect((init!.headers as Record<string, string>)['X-API-KEY']).toBe('key-1')
    expect(JSON.parse(String(init!.body))).toEqual({
      url: 'https://x.test/webhooks/pluggy',
      event: 'all',
      headers: { h: 'v' },
    })
  })

  it('createConnectToken manda o clientUserId e devolve o accessToken', async () => {
    const { client, fetch } = setup(() => ({ body: { accessToken: 'connect-1' } }))
    await expect(client.createConnectToken('user-1')).resolves.toBe('connect-1')
    const [input, init] = fetch.mock.calls.at(-1)!
    expect(new URL(String(input)).pathname).toBe('/connect_token')
    expect((init!.headers as Record<string, string>)['X-API-KEY']).toBe('key-1')
    expect(JSON.parse(String(init!.body))).toEqual({ options: { clientUserId: 'user-1' } })
  })

  it('404 em getItem vira PluggyNotFoundError', async () => {
    const { client } = setup(() => ({ status: 404, body: { message: 'not found' } }))

    await expect(client.getItem('item-x')).rejects.toBeInstanceOf(PluggyNotFoundError)
  })

  it('outro erro HTTP traz o status e a mensagem', async () => {
    const { client } = setup(() => ({ status: 500, body: { message: 'boom' } }))

    await expect(client.getItem('item-1')).rejects.toThrow(/500.*boom/)
  })
})
