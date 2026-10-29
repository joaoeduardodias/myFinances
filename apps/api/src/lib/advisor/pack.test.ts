import { describe, expect, it } from 'vitest'

import type { AnalysisMonth } from '@/lib/finance/annual-analysis'
import type { Projection } from '@/lib/finance/projection'

import { buildAdvisorPack, isEmptyPack, packPrompt } from './pack'

const today = '2026-10-15'

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

const months = [
  '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
].map((m) => month(m, { incomeCents: 500000 }))

const projection: Projection = {
  today,
  balanceCents: 200000,
  nextIncome: { recurrenceId: 'r1', description: 'SALARIO ACME', date: '2026-11-05', amountCents: 500000 },
  windowEnd: '2026-11-05',
  days: 21,
  noIncomeConfigured: false,
  payables: [
    { kind: 'BILL', refId: 'b1', description: 'Fatura Nubank', dueDate: '2026-10-20', amountCents: 80000 },
  ],
  payableTotalCents: 80000,
  availableCents: 123456,
  perDayCents: 5879,
}

const spend = new Map([
  ['2026-09', new Map([['Restaurante', 30000], ['Delivery', 50000]])],
  ['2026-10', new Map([['Restaurante', 10000], ['Mercado', -500]])],
])
const limits = [
  { category: 'Restaurante', limitCents: 40000 },
  { category: 'Delivery', limitCents: 40000 },
]

describe('buildAdvisorPack', () => {
  const pack = buildAdvisorPack({ today, projection, months, spend, limits })

  it('guarda só valores e datas dos a pagar', () => {
    expect(pack.payables).toEqual([{ dueDate: '2026-10-20', amountCents: 80000 }])
    expect(pack.spendable.untilDate).toBe('2026-11-05')
  })

  it('traz 4 meses terminando no de today', () => {
    expect(pack.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('conta limites respeitados no último mês fechado', () => {
    expect(pack.limitsKept).toEqual({ month: '2026-09', kept: 1, total: 2 })
  })

  it('limitsKept é null sem limite', () => {
    expect(buildAdvisorPack({ today, projection, months, spend, limits: [] }).limitsKept).toBeNull()
  })

  it('zera gasto negativo e lista categorias com gasto ou limite', () => {
    const mercado = pack.categories.find((c) => c.category === 'Mercado')
    expect(mercado).toBeUndefined()
    expect(pack.categories.find((c) => c.category === 'Delivery')).toEqual({
      category: 'Delivery',
      spentCents: 0,
      limitCents: 40000,
    })
  })

  it('prompt só tem totais', () => {
    const text = packPrompt({ ...pack, spendable: { ...pack.spendable, availableCents: 123456 } })
    for (const word of ['SALARIO', 'ACME', 'Fatura', 'Nubank']) expect(text).not.toContain(word)
    expect(text).toContain('R$ 1.234,56')
    expect(text).toContain('05/11')
  })
})

describe('isEmptyPack', () => {
  it('é vazio sem renda, gasto e limite', () => {
    const pack = buildAdvisorPack({
      today,
      projection: { ...projection, nextIncome: null, noIncomeConfigured: true, payables: [] },
      months,
      spend: new Map(),
      limits: [],
    })
    expect(isEmptyPack(pack)).toBe(true)
  })

  it('não é vazio com gasto', () => {
    const pack = buildAdvisorPack({
      today,
      projection: { ...projection, noIncomeConfigured: true },
      months,
      spend,
      limits: [],
    })
    expect(isEmptyPack(pack)).toBe(false)
  })
})
