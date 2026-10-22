import { describe, expect, it } from 'vitest'

import { formatBRL, formatDate, formatDateTimeToDate } from './format'

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

describe('formatDateTimeToDate', () => {
  it('shows the day of an instant in São Paulo, not in UTC', () => {
    // 02:00 UTC ainda é o dia anterior em São Paulo.
    expect(formatDateTimeToDate('2026-11-01T02:00:00.000Z')).toBe('31/10/2026')
    expect(formatDateTimeToDate('2026-11-01T15:00:00.000Z')).toBe('01/11/2026')
  })
})
