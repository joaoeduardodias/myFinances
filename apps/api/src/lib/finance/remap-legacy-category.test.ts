import { describe, expect, it } from 'vitest'
import { remapLegacyCategory } from './remap-legacy-category'

describe('remapLegacyCategory', () => {
  it('nome antigo usa a Pluggy quando cai no mesmo grupo', () => {
    expect(remapLegacyCategory('Alimentação', 'Food delivery')).toBe('Delivery')
    expect(remapLegacyCategory('Alimentação', 'Groceries')).toBe('Mercado')
    expect(remapLegacyCategory('Transporte', 'Gas stations')).toBe('Combustível')
    expect(remapLegacyCategory('Transporte', 'Vehicle maintenance')).toBe('Carro')
  })
  it('nome antigo sem pista da Pluggy cai no padrão', () => {
    expect(remapLegacyCategory('Alimentação', null)).toBe('Restaurante')
    expect(remapLegacyCategory('Transporte', 'Shopping')).toBe('Uber e táxi')
  })
  it('nome da lista nova fica como está (idempotente)', () => {
    expect(remapLegacyCategory('Delivery', 'Eating out')).toBe('Delivery')
    expect(remapLegacyCategory('Saúde', null)).toBe('Saúde')
  })
  it('nome desconhecido vira null', () => {
    expect(remapLegacyCategory('Xyz', null)).toBeNull()
  })
})
