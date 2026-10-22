import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getToken, setToken } from '@/lib/cookies'

vi.mock('@/lib/cookies', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
}))

const endSessionMock = vi.fn()
vi.mock('@/auth/end-session', () => ({ endSession: endSessionMock }))

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('api — silent refresh on 401', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refreshes the access token on 401 and retries the original request once', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(201, { token: 'new-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const result = await api.get('transactions').json<{ ok: boolean }>()

    expect(result).toEqual({ ok: true })
    expect(setToken).toHaveBeenCalledWith('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // O refresh token é o cookie `httpOnly` da API: vai pelo navegador, não
    // pelo corpo.
    const refreshRequest: Request = fetchMock.mock.calls[1][0]
    expect(refreshRequest.credentials).toBe('include')
  })

  it('shares one refresh call across concurrent 401s instead of each request rotating the token', async () => {
    // O cookie é de verdade com estado: o `beforeRequest` relê o token na
    // repetição, então `setToken` precisa mudar o que `getToken` devolve.
    let tokenCookie = 'expired-token'
    vi.mocked(getToken).mockImplementation(() => tokenCookie)
    vi.mocked(setToken).mockImplementation((token) => {
      tokenCookie = token
      return token
    })

    const fetchMock = vi.fn().mockImplementation(async (input: Request) => {
      const url = new URL(input.url)
      if (url.pathname.endsWith('/sessions/refresh')) {
        return jsonResponse(201, { token: 'new-token' })
      }
      const auth = input.headers.get('authorization')
      return auth === 'Bearer new-token'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const [a, b] = await Promise.all([
      api.get('transactions').json(),
      api.get('lots').json(),
    ])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    const refreshCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL((input as Request).url).pathname.endsWith('/sessions/refresh'),
    )
    expect(refreshCalls).toHaveLength(1)
  })

  it('adopts another tab’s already-rotated token instead of ending the session when this tab loses the refresh race', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')

    let tokenCookie = 'expired-token'
    vi.mocked(getToken).mockImplementation(() => tokenCookie)

    const fetchMock = vi.fn().mockImplementation(async (input: Request) => {
      const url = new URL(input.url)
      if (url.pathname.endsWith('/sessions/refresh')) {
        // Esta aba perde a corrida: o refresh token que ela tinha já foi
        // rotacionado por outra aba. Simula isso mudando o cookie de access
        // token como se a outra aba já tivesse escrito o dela.
        tokenCookie = 'token-from-another-tab'
        return jsonResponse(401, { message: 'Invalid refresh token.' })
      }
      const auth = input.headers.get('authorization')
      return auth === 'Bearer token-from-another-tab'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, {})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const result = await api.get('transactions').json<{ ok: boolean }>()

    expect(result).toEqual({ ok: true })
    expect(endSessionMock).not.toHaveBeenCalled()
  })

  it('ends the session when the refresh itself fails and no other tab already renewed it', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(401, {}))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.get('transactions').json()).rejects.toThrow()
    expect(endSessionMock).toHaveBeenCalled()
  })

  it('ends the session when the refresh answers 400', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(400, {}))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.get('transactions').json()).rejects.toThrow()
    expect(endSessionMock).toHaveBeenCalled()
  })

  // Sem rede ou com a API fora, a sessão ainda pode valer: sair levaria o
  // usuário para o login à toa.
  it('keeps the session when the refresh fails on the network', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.get('transactions').json()).rejects.toThrow('Failed to fetch')
    expect(endSessionMock).not.toHaveBeenCalled()
  })

  it('keeps the session when the refresh answers 5xx', async () => {
    vi.mocked(getToken).mockReturnValue('expired-token')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.get('transactions').json()).rejects.toThrow()
    expect(endSessionMock).not.toHaveBeenCalled()
  })

  it('does not try to refresh a 401 coming from the refresh call itself', async () => {
    vi.mocked(getToken).mockReturnValue(undefined)

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(401, { message: 'Invalid refresh token.' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.post('sessions/refresh').json()).rejects.toThrow()
    expect(endSessionMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // `password/reset` responde 401 para código inválido: a tela precisa do erro,
  // não de um redirect para o login.
  it('leaves a 401 from a tokenless request alone', async () => {
    vi.mocked(getToken).mockReturnValue(undefined)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {}))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(
      api.post('password/reset', { json: {} }).json(),
    ).rejects.toThrow()

    expect(endSessionMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
