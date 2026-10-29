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

  it('inclui o motivo do corpo de erro', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'model retired' } }), { status: 404 }),
    )

    await expect(generateJson(request, { fetch: fetchMock, apiKey: 'k' })).rejects.toThrow(
      '404: model retired',
    )
  })
})
