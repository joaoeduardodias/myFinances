import { describe, expect, it } from 'vitest'

import { toAccountEndpoint } from './s3-endpoint'

describe('toAccountEndpoint', () => {
  const account = 'https://abc123.r2.cloudflarestorage.com'

  it('drops the bucket from the endpoint path', () => {
    expect(toAccountEndpoint(`${account}/myfinances`, 'myfinances')).toBe(account)
    expect(toAccountEndpoint(`${account}/myfinances/`, 'myfinances')).toBe(account)
  })

  it('leaves an endpoint that is already the account one alone', () => {
    expect(toAccountEndpoint(account, 'myfinances')).toBe(account)
    expect(toAccountEndpoint(`${account}/`, 'myfinances')).toBe(account)
  })

  it('keeps a path that is not the bucket', () => {
    expect(toAccountEndpoint(`${account}/proxy`, 'myfinances')).toBe(`${account}/proxy`)
  })
})
