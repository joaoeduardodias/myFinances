import { describe, expect, it } from 'vitest'

import { emailSchema, normalizeEmail } from './email'

describe('normalizeEmail', () => {
  it('trims and lowercases the address', () => {
    expect(normalizeEmail('  Diego@Fazenda.COM.br ')).toBe(
      'diego@fazenda.com.br',
    )
  })
})

describe('emailSchema', () => {
  it('parses to the normalized address', () => {
    expect(emailSchema.parse(' Diego@Fazenda.com.br')).toBe(
      'diego@fazenda.com.br',
    )
  })

  it('rejects a value that is not an e-mail', () => {
    expect(emailSchema.safeParse('diego').success).toBe(false)
  })
})
