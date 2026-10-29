import { describe, expect, it } from 'vitest'

import { CATEGORIES, DEFAULT_GROUP, isNecessityCategory, mapPluggyCategory } from './categories'

describe('mapPluggyCategory', () => {
  it('mapeia categorias da Pluggy ignorando caixa', () => {
    expect(mapPluggyCategory('Groceries')).toBe('Mercado')
    expect(mapPluggyCategory('eating out')).toBe('Restaurante')
  })

  it('devolve null para desconhecida ou vazia', () => {
    expect(mapPluggyCategory('algo desconhecido')).toBeNull()
    expect(mapPluggyCategory(null)).toBeNull()
    expect(mapPluggyCategory(undefined)).toBeNull()
  })

  it('mapeia as categorias novas da Pluggy', () => {
    expect(mapPluggyCategory('Food delivery')).toBe('Delivery')
    expect(mapPluggyCategory('Eating out')).toBe('Restaurante')
    expect(mapPluggyCategory('Gas stations')).toBe('Combustível')
    expect(mapPluggyCategory('Vehicle maintenance')).toBe('Carro')
    expect(mapPluggyCategory('Automotive')).toBe('Carro')
    expect(mapPluggyCategory('Ride-hailing')).toBe('Uber e táxi')
    expect(mapPluggyCategory('Tolls and in vehicle payment')).toBe('Transporte público')
    expect(mapPluggyCategory('Electricity')).toBe('Moradia')
    expect(mapPluggyCategory('Real estate financing')).toBe('Moradia')
    expect(mapPluggyCategory('Pharmacy')).toBe('Farmácia')
    expect(mapPluggyCategory('Hospital clinics and labs')).toBe('Saúde')
    expect(mapPluggyCategory('Loans and financing')).toBe('Dívidas e juros')
    expect(mapPluggyCategory('Late payment and overdraft costs')).toBe('Dívidas e juros')
    expect(mapPluggyCategory('Investments')).toBe('Investimentos')
    expect(mapPluggyCategory('Transfer - PIX')).toBeNull()
  })
})

describe('DEFAULT_GROUP', () => {
  it('todo nome da lista tem grupo padrão', () => {
    for (const c of CATEGORIES) expect(DEFAULT_GROUP[c]).toBeDefined()
    expect(DEFAULT_GROUP.Delivery).toBe('avoidable')
    expect(DEFAULT_GROUP.Mercado).toBe('essential')
    expect(DEFAULT_GROUP['Dívidas e juros']).toBe('debt')
    expect(DEFAULT_GROUP.Outros).toBe('unclassified')
    expect(isNecessityCategory('Lazer')).toBe(true)
    expect(isNecessityCategory('Salário')).toBe(false)
    expect(DEFAULT_GROUP.Serviços).toBe('essential')
    expect(isNecessityCategory('Serviços')).toBe(true)
  })
})
