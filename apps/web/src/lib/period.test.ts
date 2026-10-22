import { describe, expect, it } from 'vitest'

import { currentMonthRange, todayInSaoPaulo } from './period'

describe('period', () => {
  it('uses the São Paulo calendar day, not UTC', () => {
    // 01:00 UTC de 1º de novembro ainda é 31/10 em São Paulo.
    const now = new Date('2026-11-01T01:00:00Z')
    expect(todayInSaoPaulo(now)).toBe('2026-10-31')
    expect(currentMonthRange(now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    })
  })

  it('handles February in a leap year', () => {
    expect(currentMonthRange(new Date('2028-02-10T12:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
  })
})
