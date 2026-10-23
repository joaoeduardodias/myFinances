import { describe, expect, it } from 'vitest'

import { type MatchCandidate, pickEntryMatch } from './match-entry'

function cand(id: string, date: string, extra: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id,
    accountId: 'bank-a',
    amountCents: -4500,
    date,
    createdAt: new Date('2026-10-10T10:00:00Z'),
    ...extra,
  }
}

const target = { accountId: 'bank-a', amountCents: -4500, date: '2026-10-10' }

describe('pickEntryMatch', () => {
  it('casa com mesma conta, valor e data', () => {
    expect(pickEntryMatch(target, [cand('x', '2026-10-10')])).toBe('x')
  })

  it('não casa com conta diferente', () => {
    expect(pickEntryMatch(target, [cand('x', '2026-10-10', { accountId: 'bank-b' })])).toBeNull()
  })

  it('não casa com valor diferente', () => {
    expect(pickEntryMatch(target, [cand('x', '2026-10-10', { amountCents: -4501 })])).toBeNull()
  })

  it('casa a 3 dias de diferença, antes e depois', () => {
    expect(pickEntryMatch(target, [cand('x', '2026-10-13')])).toBe('x')
    expect(pickEntryMatch(target, [cand('x', '2026-10-07')])).toBe('x')
  })

  it('não casa a 4 dias de diferença, antes e depois', () => {
    expect(pickEntryMatch(target, [cand('x', '2026-10-14')])).toBeNull()
    expect(pickEntryMatch(target, [cand('x', '2026-10-06')])).toBeNull()
  })

  it('prefere o candidato mais próximo em dias', () => {
    const picked = pickEntryMatch(target, [cand('longe', '2026-10-12'), cand('perto', '2026-10-09')])
    expect(picked).toBe('perto')
  })

  it('na mesma distância, prefere o createdAt mais antigo', () => {
    const picked = pickEntryMatch(target, [
      cand('novo', '2026-10-11', { createdAt: new Date('2026-10-20T00:00:00Z') }),
      cand('antigo', '2026-10-09', { createdAt: new Date('2026-10-01T00:00:00Z') }),
    ])
    expect(picked).toBe('antigo')
  })
})
