import { describe, expect, it } from 'vitest'

import { isAllowedOrigin } from './cors'

const APP = 'https://myfinances.example.com'

describe('isAllowedOrigin', () => {
  it('allows the origin the web app is served from', () => {
    expect(isAllowedOrigin(APP, APP)).toBe(true)
  })

  it('allows a request that carries no Origin header', () => {
    // Webhook do Pluggy, curl, healthcheck: não são navegador, e o CORS não
    // tem o que dizer sobre eles. Barrar aqui derrubaria o webhook.
    expect(isAllowedOrigin(undefined, APP)).toBe(true)
  })

  it('rejects any other site', () => {
    expect(isAllowedOrigin('https://evil.com', APP)).toBe(false)
  })

  it('rejects a host that merely starts with ours', () => {
    // O domínio do atacante contém o nosso inteiro como prefixo. Comparação
    // por `startsWith` deixaria passar.
    expect(isAllowedOrigin('https://myfinances.example.com.evil.com', APP)).toBe(
      false,
    )
  })

  it('rejects a host that merely ends with ours', () => {
    expect(isAllowedOrigin('https://evilmyfinances.example.com', APP)).toBe(
      false,
    )
  })

  it('rejects the same host over plain http', () => {
    expect(isAllowedOrigin('http://myfinances.example.com', APP)).toBe(false)
  })

  it('matches when the configured url carries a path or trailing slash', () => {
    // WEB_URL é a URL do app, não necessariamente a origin nua.
    expect(isAllowedOrigin(APP, `${APP}/`)).toBe(true)
  })

  it('allows the vite dev server in development', () => {
    expect(
      isAllowedOrigin('http://localhost:5173', 'http://localhost:5173'),
    ).toBe(true)
  })
})
