import { describe, expect, it } from 'vitest'

import type { AnalysisMonth } from '@/lib/finance/annual-analysis'

import { advisorIndicators, goalProgress, parseProposals } from './goals'

function month(m: string, extra: Partial<AnalysisMonth> = {}): AnalysisMonth {
  return {
    month: m,
    incomeCents: 0,
    essentialCents: 0,
    avoidableCents: 0,
    emergencyCents: 0,
    debtCents: 0,
    unclassifiedCents: 0,
    investedCents: 0,
    ...extra,
  }
}

const spend = new Map([
  ['2026-08', new Map([['Delivery', 50000]])],
  ['2026-09', new Map([['Delivery', 25000]])],
  ['2026-10', new Map([['Delivery', 12000]])],
])

describe('goalProgress', () => {
  it('teto de categoria: mês a mês desde o início, o atual parcial', () => {
    const months = ['2026-08', '2026-09', '2026-10'].map((m) => month(m))
    const progress = goalProgress(
      { kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 },
      '2026-09',
      { months, spend, currentMonth: '2026-10' },
    )
    expect(progress).toEqual([
      { month: '2026-09', value: 25000, met: true, partial: false },
      { month: '2026-10', value: 12000, met: true, partial: true },
    ])
  })

  it('teto estourado não cumpre', () => {
    const progress = goalProgress(
      { kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 },
      '2026-08',
      { months: [month('2026-08')], spend, currentMonth: '2026-10' },
    )
    expect(progress).toEqual([{ month: '2026-08', value: 50000, met: false, partial: false }])
  })

  it('sobra: % da renda menos os gastos, investido conta como sobra; mês sem renda fica de fora', () => {
    const months = [
      month('2026-09', { incomeCents: 500000, essentialCents: 300000, avoidableCents: 100000, investedCents: 50000 }),
      month('2026-10'),
    ]
    const progress = goalProgress({ kind: 'SAVINGS', targetPercent: 20 }, '2026-09', {
      months,
      spend,
      currentMonth: '2026-10',
    })
    expect(progress).toEqual([{ month: '2026-09', value: 20, met: true, partial: false }])
  })
})

describe('parseProposals', () => {
  const ctx = { incomeConfigured: true, active: [] }

  it('aceita teto em reais de categoria de limite e sobra em %', () => {
    expect(
      parseProposals(
        [
          { kind: 'CATEGORY', category: 'Delivery', targetReais: 300 },
          { kind: 'SAVINGS', targetPercent: 15 },
        ],
        ctx,
      ),
    ).toEqual([
      { kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 },
      { kind: 'SAVINGS', targetPercent: 15 },
    ])
  })

  it('descarta categoria inventada, valor fora da faixa, repetida e igual a meta ativa; no máximo 3', () => {
    const result = parseProposals(
      [
        { kind: 'CATEGORY', category: 'Ifood', targetReais: 300 },
        { kind: 'CATEGORY', category: 'Delivery', targetReais: 0 },
        { kind: 'SAVINGS', targetPercent: 95 },
        { kind: 'CATEGORY', category: 'Restaurante', targetReais: 200 },
        { kind: 'CATEGORY', category: 'Restaurante', targetReais: 200 },
        { kind: 'CATEGORY', category: 'Mercado', targetReais: 800 },
        { kind: 'CATEGORY', category: 'Lazer', targetReais: 100 },
        { kind: 'CATEGORY', category: 'Delivery', targetReais: 250 },
      ],
      { incomeConfigured: true, active: [{ kind: 'CATEGORY', category: 'Mercado', targetCents: 80000 }] },
    )
    expect(result).toEqual([
      { kind: 'CATEGORY', category: 'Restaurante', targetCents: 20000 },
      { kind: 'CATEGORY', category: 'Lazer', targetCents: 10000 },
      { kind: 'CATEGORY', category: 'Delivery', targetCents: 25000 },
    ])
  })

  it('sem renda configurada não propõe sobra; lixo vira lista vazia', () => {
    expect(parseProposals([{ kind: 'SAVINGS', targetPercent: 10 }], { incomeConfigured: false, active: [] })).toEqual([])
    expect(parseProposals('nada', ctx)).toEqual([])
  })
})

describe('advisorIndicators', () => {
  it('sobra e essencial em % por mês, tendência da renda e categorias em alta', () => {
    const incomes = [400000, 400000, 400000, 500000, 500000, 500000, 0]
    const names = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    const months = names.map((m, i) =>
      month(m, { incomeCents: incomes[i], essentialCents: incomes[i] / 2, avoidableCents: incomes[i] / 4 }),
    )
    const rising = new Map([
      ['2026-07', new Map([['Delivery', 10000], ['Mercado', 50000]])],
      ['2026-08', new Map([['Delivery', 20000], ['Mercado', 40000]])],
      ['2026-09', new Map([['Delivery', 30000], ['Mercado', 60000]])],
    ])

    const result = advisorIndicators(months, rising, '2026-10')

    expect(result.months[0]).toEqual({ month: '2026-04', savedPercent: 25, essentialPercent: 50 })
    expect(result.months.at(-1)).toEqual({ month: '2026-10', savedPercent: null, essentialPercent: null })
    expect(result.incomeTrend).toBe('UP')
    expect(result.risingCategories).toEqual(['Delivery'])
  })

  it('sem 6 meses fechados com renda não há tendência', () => {
    const months = ['2026-09', '2026-10'].map((m) => month(m, { incomeCents: 100000 }))
    expect(advisorIndicators(months, new Map(), '2026-10').incomeTrend).toBeNull()
  })
})
