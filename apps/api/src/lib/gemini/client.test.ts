import { describe, expect, it, vi } from 'vitest'

import { GeminiUnavailableError, generateJson } from './client'

const request = {
  system: 'sistema',
  parts: [{ text: 'olá' }],
  schema: { type: 'object' },
}

function ok(text: string, status = 200) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status,
  })
}

describe('generateJson', () => {
  it('manda sistema, partes e schema e devolve o texto cru', async () => {
    const fetchMock = vi.fn(async () => ok('{"a":1}'))

    const text = await generateJson(request, { fetch: fetchMock, apiKey: 'k' })

    expect(text).toBe('{"a":1}')
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const body = JSON.parse(init.body as string)
    expect(body.system_instruction).toEqual({ parts: [{ text: 'sistema' }] })
    expect(body.contents[0].parts).toEqual(request.parts)
    expect(body.generationConfig.responseJsonSchema).toEqual(request.schema)
  })

  it('tenta de novo uma vez em 503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(ok('{}'))

    await generateJson(request, { fetch: fetchMock, apiKey: 'k', retryDelayMs: 0 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falha sem chave', async () => {
    await expect(generateJson(request, { apiKey: '', fetch: vi.fn() })).rejects.toBeInstanceOf(
      GeminiUnavailableError,
    )
  })

  it('espera 15 s por padrão ou o tempo pedido', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')

    await generateJson(request, { fetch: vi.fn(async () => ok('{}')), apiKey: 'k' })
    await generateJson(request, { fetch: vi.fn(async () => ok('{}')), apiKey: 'k', timeoutMs: 60_000 })

    expect(timeout.mock.calls).toEqual([[15_000], [60_000]])
    timeout.mockRestore()
  })

  it('diz quando o Gemini passou do tempo', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })

    await expect(generateJson(request, { fetch: fetchMock, apiKey: 'k' })).rejects.toThrow(
      'Gemini não respondeu em 15 s',
    )
  })

  it('inclui a causa da falha de rede', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
    })

    await expect(generateJson(request, { fetch: fetchMock, apiKey: 'k' })).rejects.toThrow(
      'Falha de rede ao chamar o Gemini: ENOTFOUND',
    )
  })

  it('inclui o motivo do corpo de erro', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'model retired' } }), { status: 404 }),
    )

    await expect(generateJson(request, { fetch: fetchMock, apiKey: 'k' })).rejects.toThrow(
      '404: model retired',
    )
  })
})
