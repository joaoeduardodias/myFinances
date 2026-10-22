import { describe, expect, it } from 'vitest'

import { toCents } from './money'

describe('toCents', () => {
  it('usa o sinal do type, não do valor', () => {
    expect(toCents(212.45, 'DEBIT')).toBe(-21245)
    expect(toCents(-212.45, 'DEBIT')).toBe(-21245)
    expect(toCents(-10, 'CREDIT')).toBe(1000)
  })

  it('arredonda em vez de truncar', () => {
    expect(toCents(0.1 + 0.2, 'CREDIT')).toBe(30)
  })
})
