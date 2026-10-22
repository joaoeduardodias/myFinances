import { describe, expect, it } from 'vitest'

import { mapPluggyCategory } from './categories'

describe('mapPluggyCategory', () => {
  it('mapeia categorias da Pluggy ignorando caixa', () => {
    expect(mapPluggyCategory('Groceries')).toBe('Mercado')
    expect(mapPluggyCategory('eating out')).toBe('Alimentação')
  })

  it('devolve null para desconhecida ou vazia', () => {
    expect(mapPluggyCategory('algo desconhecido')).toBeNull()
    expect(mapPluggyCategory(null)).toBeNull()
    expect(mapPluggyCategory(undefined)).toBeNull()
  })
})
