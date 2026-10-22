import fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { trustProxy } from './trusted-proxy'

async function ipFor(forwardedFor?: string) {
  const app = fastify({ trustProxy })
  app.get('/', async (request) => ({ ip: request.ip }))
  const response = await app.inject({
    method: 'GET',
    url: '/',
    remoteAddress: '10.0.0.1',
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
  })
  await app.close()
  return response.json().ip
}

describe('trusted proxy', () => {
  it('takes the address the proxy appended, not one the client wrote', async () => {
    // O proxy acrescenta ao X-Forwarded-For que veio do cliente: o primeiro
    // valor é de quem chamou, só o último é do proxy.
    expect(await ipFor('9.9.9.9, 1.2.3.4, 200.150.10.5')).toBe('200.150.10.5')
  })

  it('takes the client address when the proxy is the only writer', async () => {
    expect(await ipFor('200.150.10.5')).toBe('200.150.10.5')
  })

  it('falls back to the socket address without a proxy header', async () => {
    expect(await ipFor()).toBe('10.0.0.1')
  })
})
