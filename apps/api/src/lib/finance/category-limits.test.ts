import { describe, expect, it } from 'vitest'

import type { AnalysisTx } from './annual-analysis'
import type { Necessity } from './categories'
import { closedMonths, LIMIT_CATEGORIES, monthlyCategorySpend, needsRevision, proposeLimit } from './category-limits'

const none = new Map<string, Necessity>()

let seq = 0
function tx(extra: Partial<AnalysisTx>): AnalysisTx {
  seq += 1
  return {
    id: `t${seq}`,
    date: '2026-09-10',
    description: 'x',
    amountCents: -1000,
    category: null,
    necessity: null,
    isTransfer: false,
    accountType: 'BANK',
    accountName: 'Caixa',
    ...extra,
  }
}

describe('monthlyCategorySpend', () => {
  it('crédito abate o débito da categoria no mesmo mês', () => {
    const m = monthlyCategorySpend(
      [tx({ category: 'Mercado', amountCents: -5000 }), tx({ category: 'Mercado', amountCents: 1000 })],
      none,
    )
    expect(m.get('2026-09')?.get('Mercado')).toBe(4000)
  })

  it('ignora transferência, categorias fora do limite e sem categoria', () => {
    const m = monthlyCategorySpend(
      [
        tx({ category: 'Mercado', isTransfer: true }),
        tx({ category: 'Investimentos' }),
        tx({ category: 'Dívidas e juros' }),
        tx({ category: 'Outros' }),
        tx({ category: null }),
      ],
      none,
    )
    expect(m.size).toBe(0)
  })

  it('emergência entra na própria categoria', () => {
    const m = monthlyCategorySpend([tx({ category: 'Delivery', amountCents: -3000, necessity: 'EMERGENCY' })], none)
    expect(m.get('2026-09')?.get('Delivery')).toBe(3000)
  })
})

describe('LIMIT_CATEGORIES', () => {
  it('só essenciais e evitáveis', () => {
    expect(LIMIT_CATEGORIES).toContain('Mercado')
    expect(LIMIT_CATEGORIES).not.toContain('Outros')
  })
})

describe('closedMonths', () => {
  it('corta antes da primeira transação', () => {
    expect(closedMonths('2026-10-28', 6, '2026-07-15')).toEqual(['2026-07', '2026-08', '2026-09'])
  })
  it('devolve os 6 meses fechados', () => {
    expect(closedMonths('2026-10-28', 6, '2025-01-01')).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
  })
  it('sem firstDate, vazio', () => {
    expect(closedMonths('2026-10-28', 6, undefined)).toEqual([])
  })
})

describe('proposeLimit', () => {
  it('mediana arredondada para cima em R$ 10', () => {
    expect(proposeLimit([30000, 41000, 50000])).toBe(41000)
    expect(proposeLimit([30000, 41500])).toBe(36000)
  })
  it('null sem histórico ou mediana <= 0', () => {
    expect(proposeLimit([])).toBeNull()
    expect(proposeLimit([0, 0, 500])).toBeNull()
  })
})

describe('needsRevision', () => {
  it('passou em 2 dos 3 meses', () => {
    expect(needsRevision(50000, [60000, 55000, 40000])).toBe(true)
  })
  it('abaixo de 60% nos 3', () => {
    expect(needsRevision(50000, [20000, 25000, 29000])).toBe(true)
  })
  it('caso normal', () => {
    expect(needsRevision(50000, [20000, 31000, 29000])).toBe(false)
  })
  it('exige 3 meses', () => {
    expect(needsRevision(50000, [60000, 60000])).toBe(false)
  })
})
