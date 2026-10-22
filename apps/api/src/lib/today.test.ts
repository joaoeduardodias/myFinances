import { describe, expect, it } from 'vitest'

import { todayIso } from './today'

describe('todayIso', () => {
  it('usa o fuso de São Paulo na virada do dia', () => {
    expect(
      todayIso('America/Sao_Paulo', new Date('2026-10-23T02:30:00Z')),
    ).toBe('2026-10-22')
  })

  it('usa TIMEZONE do ambiente por padrão', () => {
    expect(todayIso(undefined, new Date('2026-10-23T02:30:00Z'))).toBe(
      '2026-10-22',
    )
  })
})
