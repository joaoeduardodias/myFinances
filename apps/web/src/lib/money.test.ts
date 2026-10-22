import { describe, expect, it } from 'vitest'

import { parseReaisToCents } from './money'

describe('parseReaisToCents', () => {
  it.each([
    ['20', 2000],
    ['20,50', 2050],
    ['20,5', 2050],
    ['1.234,56', 123456],
    ['0,99', 99],
    ['R$ 10,00', 1000],
    ['1.005,10', 100510],
  ])('converts %s', (input, cents) => {
    expect(parseReaisToCents(input)).toBe(cents)
  })

  it.each(['', 'abc', '0', '0,00', '1,234', '1,2,3', '-5', '1.5'])(
    'rejects %s',
    (input) => {
      expect(parseReaisToCents(input)).toBeNull()
    },
  )
})
