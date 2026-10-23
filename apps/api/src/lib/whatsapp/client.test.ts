import { describe, expect, it, vi } from 'vitest'

import { createWhatsappClient } from './client'

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('createWhatsappClient', () => {
  it('sendText faz o POST com Bearer e o corpo da Cloud API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}))
    const client = createWhatsappClient({ accessToken: 'tok', phoneNumberId: '99', fetch: fetchMock })
    await client.sendText('5511999999999', 'oi')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v23.0/99/messages')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '5511999999999',
      type: 'text',
      text: { body: 'oi' },
    })
  })

  it('sendText rejeita quando a Meta responde erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x', { status: 400 }))
    const client = createWhatsappClient({ accessToken: 't', phoneNumberId: '1', fetch: fetchMock })
    await expect(client.sendText('1', 'a')).rejects.toThrow()
  })

  it('downloadMedia busca a URL da mídia e depois os bytes, ambos com Bearer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ url: 'https://cdn.test/m', mime_type: 'image/jpeg' }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
    const client = createWhatsappClient({ accessToken: 'tok', phoneNumberId: '99', fetch: fetchMock })
    const media = await client.downloadMedia('mid')
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v23.0/mid')
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.test/m')
    for (const call of fetchMock.mock.calls) expect(call[1].headers.Authorization).toBe('Bearer tok')
    expect(media.mimeType).toBe('image/jpeg')
    expect([...media.data]).toEqual([1, 2, 3])
  })
})
