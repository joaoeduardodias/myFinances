import { describe, expect, it } from 'vitest'

import { parsePayslip } from './parse'

describe('parsePayslip', () => {
  it('sem layout conhecido, devolve null', () => {
    expect(parsePayslip(Buffer.from('%PDF-1.4 qualquer'))).toBeNull()
  })
})
