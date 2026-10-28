import { describe, expect, it } from 'vitest'

import { decideAlerts } from './alerts'

const nextIncome = { recurrenceId: 'r1', description: 'Salário', date: '2026-11-05', amountCents: 500000 }

function run(over: Partial<Parameters<typeof decideAlerts>[0]> = {}) {
  return decideAlerts({
    today: '2026-10-28',
    projection: { availableCents: 100000, noIncomeConfigured: false, nextIncome },
    wasNegative: false,
    limits: [],
    spent: new Map(),
    existingKeys: new Set(),
    ...over,
  })
}

const mercado = (spent: number, existingKeys: string[] = []) =>
  run({
    limits: [{ category: 'Mercado', limitCents: 80000 }],
    spent: new Map([['Mercado', spent]]),
    existingKeys: new Set(existingKeys),
  })

describe('decideAlerts: saldo', () => {
  it('negativo sem aviso anterior gera o aviso', () => {
    const r = run({ projection: { availableCents: -12000, noIncomeConfigured: false, nextIncome } })
    expect(r.negative).toBe(true)
    expect(r.notifications).toHaveLength(1)
    expect(r.notifications[0]).toMatchObject({
      kind: 'SPENDABLE_NEGATIVE',
      dedupeKey: null,
      title: 'Quanto posso gastar ficou negativo',
    })
    expect(r.notifications[0].body).toContain('R$ 120,00')
    expect(r.notifications[0].body).toContain('05/11')
    expect(r.notifications[0].body).toContain('Salário')
  })

  it('negativo com aviso anterior não repete', () => {
    const r = run({
      projection: { availableCents: -12000, noIncomeConfigured: false, nextIncome },
      wasNegative: true,
    })
    expect(r).toEqual({ notifications: [], negative: true })
  })

  it('positivo depois de negativo rearma', () => {
    expect(run({ wasNegative: true })).toEqual({ notifications: [], negative: false })
  })

  it('sem renda configurada não avisa e mantém o estado', () => {
    for (const wasNegative of [true, false]) {
      const r = run({
        projection: { availableCents: -12000, noIncomeConfigured: true, nextIncome: null },
        wasNegative,
      })
      expect(r).toEqual({ notifications: [], negative: wasNegative })
    }
  })
})

describe('decideAlerts: categorias', () => {
  it('80% gera o aviso de 80', () => {
    const r = mercado(64000)
    expect(r.notifications).toHaveLength(1)
    expect(r.notifications[0]).toMatchObject({
      kind: 'CATEGORY_WARNING',
      dedupeKey: 'category:Mercado:2026-10:80',
      title: 'Mercado chegou a 80% do limite',
      body: 'R$ 640,00 de R$ 800,00 em outubro.',
    })
  })

  it('abaixo de 80% não gera', () => {
    expect(mercado(63999).notifications).toEqual([])
  })

  it('com a chave 80 existente não repete; no limite gera só 100', () => {
    expect(mercado(72000, ['category:Mercado:2026-10:80']).notifications).toEqual([])
    const r = mercado(80000, ['category:Mercado:2026-10:80'])
    expect(r.notifications.map((n) => n.kind)).toEqual(['CATEGORY_EXCEEDED'])
    expect(r.notifications[0].dedupeKey).toBe('category:Mercado:2026-10:100')
    expect(r.notifications[0].title).toBe('Mercado atingiu o limite')
  })

  it('de 0 direto ao limite gera só o 100; depois do estorno nada', () => {
    const r = run({
      limits: [{ category: 'Mercado', limitCents: 100000 }],
      spent: new Map([['Mercado', 100000]]),
    })
    expect(r.notifications.map((n) => n.kind)).toEqual(['CATEGORY_EXCEEDED'])
    const after = run({
      limits: [{ category: 'Mercado', limitCents: 100000 }],
      spent: new Map([['Mercado', 70000]]),
      existingKeys: new Set(['category:Mercado:2026-10:100']),
    })
    expect(after.notifications).toEqual([])
  })

  it('chave 100 existente impede o 80', () => {
    expect(mercado(70000, ['category:Mercado:2026-10:100']).notifications).toEqual([])
  })

  it('categoria sem limite não gera', () => {
    expect(run({ spent: new Map([['Mercado', 999999]]) }).notifications).toEqual([])
  })
})
