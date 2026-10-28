import { describe, expect, it } from 'vitest'

import { type AnalysisTx, annualAnalysis, classify } from './annual-analysis'
import type { Necessity } from './categories'

const today = '2026-10-27'
const none = new Map<string, Necessity>()

let seq = 0
function tx(extra: Partial<AnalysisTx>): AnalysisTx {
  seq += 1
  return {
    id: `t${seq}`,
    date: '2026-10-10',
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

function run(transactions: AnalysisTx[], extra: { month?: string; overrides?: Map<string, Necessity>; firstDate?: string } = {}) {
  return annualAnalysis({ today, transactions, overrides: extra.overrides ?? none, month: extra.month, firstDate: extra.firstDate })
}

const october = (a: ReturnType<typeof run>) => a.months.find((m) => m.month === '2026-10')

describe('annualAnalysis', () => {
  it('transferência não conta em lugar nenhum', () => {
    const transfers = [
      tx({ amountCents: -50000, isTransfer: true, category: 'Compras' }),
      tx({ amountCents: 50000, isTransfer: true, accountType: 'CREDIT' }),
      tx({ amountCents: -20000, isTransfer: true }),
    ]
    expect(classify(transfers[0], none)).toEqual({ kind: 'ignored' })
    const a = run(transfers)
    expect(a.totals).toEqual({
      incomeCents: 0, essentialCents: 0, avoidableCents: 0, debtCents: 0, unclassifiedCents: 0, investedCents: 0,
    })
    expect(a.categories).toEqual([])
    expect(a.topExpenses).toEqual([])
    expect(a.uncategorized).toEqual({ count: 0, totalCents: 0 })
  })

  it('salário em conta é entrada; crédito sem categoria no cartão é ignorado', () => {
    const salary = tx({ amountCents: 500000, category: 'Salário' })
    const pix = tx({ amountCents: 10000 })
    const cardCredit = tx({ amountCents: 7000, accountType: 'CREDIT' })
    const cardOther = tx({ amountCents: 3000, accountType: 'CREDIT', category: 'Outros' })
    expect(classify(salary, none)).toEqual({ kind: 'income' })
    expect(classify(cardCredit, none)).toEqual({ kind: 'ignored' })
    expect(classify(cardOther, none)).toEqual({ kind: 'ignored' })
    const a = run([salary, pix, cardCredit, cardOther])
    expect(a.totals.incomeCents).toBe(510000)
    expect(october(a)?.incomeCents).toBe(510000)
  })

  it('estorno no cartão com categoria Compras abate Compras', () => {
    const a = run([
      tx({ amountCents: -10000, category: 'Compras', accountType: 'CREDIT' }),
      tx({ amountCents: 3000, category: 'Compras', accountType: 'CREDIT' }),
    ])
    expect(a.categories).toEqual([
      expect.objectContaining({ category: 'Compras', group: 'avoidable', totalCents: 7000, count: 2 }),
    ])
    expect(a.totals.avoidableCents).toBe(7000)
    expect(a.totals.incomeCents).toBe(0)
  })

  it('devolução maior que o gasto deixa a categoria negativa', () => {
    const a = run([
      tx({ amountCents: -2000, category: 'Restaurante' }),
      tx({ amountCents: 5000, category: 'Restaurante' }),
    ])
    expect(a.categories[0]).toMatchObject({ category: 'Restaurante', totalCents: -3000 })
    expect(october(a)?.avoidableCents).toBe(-3000)
  })

  it('marca na mão vence a categoria e tira de Outros/sem categoria', () => {
    const marked = [
      tx({ amountCents: -1000, category: 'Restaurante', necessity: 'ESSENTIAL' }),
      tx({ amountCents: -2000, category: 'Outros', necessity: 'AVOIDABLE' }),
      tx({ amountCents: -4000, category: null, necessity: 'ESSENTIAL' }),
    ]
    expect(marked.map((t) => classify(t, none))).toEqual([
      { kind: 'spend', group: 'essential' },
      { kind: 'spend', group: 'avoidable' },
      { kind: 'spend', group: 'essential' },
    ])
    const a = run([...marked, tx({ amountCents: -8000, category: 'Outros' })])
    expect(a.totals).toMatchObject({ essentialCents: 5000, avoidableCents: 2000, unclassifiedCents: 8000 })
  })

  it('troca de padrão do usuário vale para a categoria', () => {
    const overrides = new Map<string, Necessity>([['Delivery', 'ESSENTIAL']])
    const delivery = tx({ amountCents: -3000, category: 'Delivery' })
    expect(classify(delivery, overrides)).toEqual({ kind: 'spend', group: 'essential' })
    expect(classify(tx({ amountCents: -1000, category: 'Delivery', necessity: 'AVOIDABLE' }), overrides)).toEqual({
      kind: 'spend',
      group: 'avoidable',
    })
    const a = run([delivery], { overrides })
    expect(a.totals).toMatchObject({ essentialCents: 3000, avoidableCents: 0 })
    expect(a.categories[0]).toMatchObject({ category: 'Delivery', group: 'essential' })
  })

  it('Dívidas e juros vai para dívida e Investimentos fica fora dos gastos', () => {
    const a = run([
      tx({ amountCents: -1500, category: 'Dívidas e juros' }),
      tx({ amountCents: -100000, category: 'Investimentos' }),
      tx({ amountCents: 40000, category: 'Investimentos' }),
    ])
    expect(a.totals).toMatchObject({ debtCents: 1500, investedCents: 100000, incomeCents: 0 })
    expect(a.categories.map((c) => c.category)).toEqual(['Dívidas e juros'])
    expect(a.categories[0].group).toBe('debt')
    expect(a.topExpenses.map((e) => e.category)).toEqual(['Dívidas e juros'])
  })

  it('data futura fica de fora', () => {
    const a = run([
      tx({ date: '2026-11-10', amountCents: -9000, category: 'Compras', accountType: 'CREDIT' }),
      tx({ date: '2025-10-31', amountCents: -7000, category: 'Compras' }),
      tx({ date: '2026-10-27', amountCents: -1000, category: 'Compras' }),
    ])
    expect(a.from).toBe('2025-11-01')
    expect(a.to).toBe(today)
    expect(a.totals.avoidableCents).toBe(1000)
    expect(a.topExpenses).toHaveLength(1)
  })

  it('meses sem dado saem zerados e a média divide pelos meses desde a primeira transação', () => {
    const old = run([tx({ date: '2025-10-23', amountCents: -500 }), tx({ amountCents: -12000, category: 'Mercado' })])
    expect(old.months.map((m) => m.month)).toEqual([
      '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ])
    expect(old.months[0]).toEqual({
      month: '2025-11', incomeCents: 0, essentialCents: 0, avoidableCents: 0, debtCents: 0, unclassifiedCents: 0, investedCents: 0,
    })
    expect(old.categories.find((c) => c.category === 'Mercado')?.averageCents).toBe(1000)

    const recent = run([tx({ date: '2026-08-05', amountCents: -6000, category: 'Mercado' }), tx({ amountCents: -3000, category: 'Mercado' })])
    expect(recent.categories[0]).toMatchObject({ totalCents: 9000, averageCents: 3000, count: 2 })

    const withFirstDate = run([tx({ amountCents: -12000, category: 'Mercado' })], { firstDate: '2024-01-02' })
    expect(withFirstDate.categories[0].averageCents).toBe(1000)
  })

  it('filtro de mês recorta totais, categorias e maiores gastos mas mantém os 12 meses', () => {
    const a = run(
      [
        tx({ date: '2026-09-15', amountCents: -6000, category: 'Mercado' }),
        tx({ date: '2026-09-20', amountCents: -2000, category: 'Lazer' }),
        tx({ date: '2026-09-21', amountCents: -500 }),
        tx({ date: '2026-10-05', amountCents: -4000, category: 'Mercado' }),
        tx({ date: '2026-10-06', amountCents: 300000, category: 'Salário' }),
      ],
      { month: '2026-10', firstDate: '2026-09-01' },
    )
    expect(a.month).toBe('2026-10')
    expect(a.months).toHaveLength(12)
    expect(a.months.find((m) => m.month === '2026-09')).toMatchObject({ essentialCents: 6000, avoidableCents: 2000 })
    expect(a.totals).toMatchObject({ essentialCents: 4000, avoidableCents: 0, incomeCents: 300000, unclassifiedCents: 0 })
    expect(a.categories).toEqual([
      { category: 'Mercado', group: 'essential', totalCents: 4000, averageCents: 5000, count: 1 },
    ])
    expect(a.topExpenses.map((e) => e.amountCents)).toEqual([-4000])
    expect(a.topAvoidable).toEqual([])
    expect(a.uncategorized).toEqual({ count: 0, totalCents: 0 })
  })

  it('topExpenses tem no máximo 10, maior débito primeiro, e topAvoidable só evitáveis', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      tx({ amountCents: -(i + 1) * 100, category: i % 2 === 0 ? 'Lazer' : 'Mercado', description: `d${i}` }),
    )
    const a = run([...many, tx({ amountCents: 99999, category: 'Lazer' })])
    expect(a.topExpenses).toHaveLength(10)
    expect(a.topExpenses.map((e) => e.amountCents)).toEqual([-1200, -1100, -1000, -900, -800, -700, -600, -500, -400, -300])
    expect(a.topExpenses[0]).toMatchObject({ description: 'd11', group: 'essential', accountName: 'Caixa' })
    expect(a.topExpenses[0]).not.toHaveProperty('isTransfer')
    expect(a.topExpenses[0]).not.toHaveProperty('accountType')
    expect(a.topAvoidable.map((e) => e.amountCents)).toEqual([-1100, -900, -700, -500, -300, -100])
    expect(a.topAvoidable.every((e) => e.group === 'avoidable')).toBe(true)
  })

  it('uncategorized conta só débitos sem categoria', () => {
    const a = run([
      tx({ amountCents: -1000 }),
      tx({ amountCents: -2500, necessity: 'AVOIDABLE' }),
      tx({ amountCents: 4000 }),
      tx({ amountCents: -800, category: 'Outros' }),
      tx({ amountCents: -9000, isTransfer: true }),
    ])
    expect(a.uncategorized).toEqual({ count: 2, totalCents: 3500 })
  })
})
