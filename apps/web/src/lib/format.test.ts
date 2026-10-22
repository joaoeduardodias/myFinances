import { describe, expect, it } from 'vitest'

import { formatBRL, formatDate } from './format'

describe('formatBRL', () => {
  it('formats positive cents with a normal space after R$', () => {
    expect(formatBRL(500)).toBe('R$ 5,00')
  })

  it('formats negative cents', () => {
    expect(formatBRL(-123456)).toBe('-R$ 1.234,56')
  })

  it('formats zero', () => {
    expect(formatBRL(0)).toBe('R$ 0,00')
  })
})

describe('formatDate', () => {
  it('formats an ISO date as dd/mm/yyyy without timezone shifts', () => {
    expect(formatDate('2026-10-22')).toBe('22/10/2026')
  })
})
