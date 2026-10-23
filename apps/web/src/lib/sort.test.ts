import { describe, expect, it } from 'vitest'

import { sortRows, toggleSort } from './sort'

describe('sort', () => {
  it('flips the same column and starts another one ascending', () => {
    expect(toggleSort(null, 'a')).toEqual({ column: 'a', order: 'asc' })
    expect(toggleSort({ column: 'a', order: 'asc' }, 'a')).toEqual({
      column: 'a',
      order: 'desc',
    })
    expect(toggleSort({ column: 'a', order: 'desc' }, 'b')).toEqual({
      column: 'b',
      order: 'asc',
    })
  })

  it('sorts numbers and pt-BR text, keeping empty values last', () => {
    const rows = [
      { name: 'Óculos', n: 2 },
      { name: null, n: 10 },
      { name: 'abacaxi', n: 1 },
    ]
    const value = (r: (typeof rows)[number], c: 'name' | 'n') => r[c]
    expect(
      sortRows(rows, { column: 'name', order: 'asc' }, value).map(
        (r) => r.name,
      ),
    ).toEqual(['abacaxi', 'Óculos', null])
    expect(
      sortRows(rows, { column: 'name', order: 'desc' }, value).map(
        (r) => r.name,
      ),
    ).toEqual(['Óculos', 'abacaxi', null])
    expect(
      sortRows(rows, { column: 'n', order: 'desc' }, value).map((r) => r.n),
    ).toEqual([10, 2, 1])
  })
})
