import Cookies from 'js-cookie'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearToken, setToken } from './cookies'

vi.mock('js-cookie', () => ({
  default: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}))

const set = vi.mocked(Cookies.set)
const remove = vi.mocked(Cookies.remove)

afterEach(() => {
  vi.unstubAllGlobals()
  set.mockClear()
  remove.mockClear()
})

describe('session cookies', () => {
  it('marks the token cookie as secure over https', () => {
    vi.stubGlobal('location', { protocol: 'https:' })

    setToken('a-token')

    expect(set).toHaveBeenCalledWith(
      'token',
      'a-token',
      expect.objectContaining({ secure: true }),
    )
  })

  it('drops secure over http and keeps sameSite lax with a 30-day expiry', () => {
    vi.stubGlobal('location', { protocol: 'http:' })

    setToken('a-token')

    expect(set).toHaveBeenCalledWith('token', 'a-token', {
      sameSite: 'lax',
      secure: false,
      expires: 30,
    })
  })

  it('removes the legacy readable refresh token cookie', () => {
    vi.stubGlobal('location', { protocol: 'http:' })

    setToken('a-token')
    clearToken()

    expect(remove).toHaveBeenCalledWith('refresh_token')
    expect(remove).toHaveBeenCalledWith('token')
  })
})
