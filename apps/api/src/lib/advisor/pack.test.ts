import { describe, expect, it } from 'vitest'

import type { AnalysisMonth } from '@/lib/finance/annual-analysis'
import type { Projection } from '@/lib/finance/projection'

import { buildAdvisorPack, fullHistoryStart, isEmptyPack, packPrompt } from './pack'

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

  it('traz os 12 meses terminando no de today', () => {
    expect(pack.months.map((m) => m.month)).toEqual(months.map((m) => m.month))
  })

  it('pula os meses do começo sem nenhum dado', () => {
    const sparse = months.map((m, i) => (i < 9 ? month(m.month) : m))
    const trimmed = buildAdvisorPack({ today, projection, months: sparse, spend, limits })
    expect(trimmed.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('prompt traz metas com andamento e indicadores', () => {
    const goals = [
      { target: { kind: 'CATEGORY' as const, category: 'Restaurante', targetCents: 20000 }, startMonth: '2026-09' },
      { target: { kind: 'SAVINGS' as const, targetPercent: 20 }, startMonth: '2026-10' },
    ]
    const withGoals = buildAdvisorPack({ today, projection, months, spend, limits, goals })
    const text = packPrompt(withGoals)
    expect(withGoals.goals[0].months).toEqual([
      { month: '2026-09', value: 30000, met: false, partial: false },
      { month: '2026-10', value: 10000, met: true, partial: true },
    ])
    expect(text).toContain('Metas ativas:')
    expect(text).toContain('- Restaurante até R$ 200,00/mês desde setembro de 2026: setembro de 2026 R$ 300,00 estourou; outubro de 2026 R$ 100,00 até agora')
    expect(text).toContain('- Sobra de pelo menos 20% da renda desde outubro de 2026: outubro de 2026 100% até agora')
    expect(text).toContain('Tendência da renda: estável.')
    expect(text).toContain('sobra 100%')
    expect(text).toContain('- novembro de 2025: R$ 5.000,00')
    expect(text).not.toMatch(/\d{4}-\d{2}/)
  })

  it('começa no mês em que a conta da renda já tinha dados e avisa no prompt', () => {
    const short = buildAdvisorPack({ today, projection, months, spend, limits, historyStartMonth: '2026-09' })
    expect(short.months.map((m) => m.month)).toEqual(['2026-09', '2026-10'])
    expect(packPrompt(short)).toContain(
      'Histórico completo só desde setembro de 2026: antes disso falta a conta que recebe a renda.',
    )
    expect(packPrompt(pack)).not.toContain('Histórico completo')
  })

  it('início depois do mês atual deixa só o mês atual', () => {
    const none = buildAdvisorPack({ today, projection, months, spend, limits, historyStartMonth: '2026-11' })
    expect(none.months.map((m) => m.month)).toEqual(['2026-10'])
  })

  it('prompt traz o investido de cada mês', () => {
    const withInvested = months.map((m) => (m.month === '2026-09' ? { ...m, investedCents: 70000 } : m))
    const text = packPrompt(buildAdvisorPack({ today, projection, months: withInvested, spend, limits }))
    expect(text).toContain('investido')
    expect(text).toContain('R$ 700,00')
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

  it('sem renda, o prompt ainda traz quanto posso gastar até o fim do mês', () => {
    const noIncome = buildAdvisorPack({
      today,
      projection: {
        ...projection,
        nextIncome: null,
        noIncomeConfigured: true,
        windowEnd: '2026-10-31',
        availableCents: 50000,
        perDayCents: 3125,
      },
      months,
      spend,
      limits,
    })
    const text = packPrompt(noIncome)
    expect(text).toContain('Sem renda configurada.')
    expect(text).toContain('Quanto posso gastar até o fim do mês (31/10): R$ 500,00 no total, R$ 31,25 por dia.')
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

describe('fullHistoryStart', () => {
  it('primeiro mês completo depois da conta de renda mais nova', () => {
    expect(fullHistoryStart(['2025-10-23', '2026-09-23'])).toBe('2026-10')
  })

  it('conta que começa no dia 1 vale o próprio mês', () => {
    expect(fullHistoryStart(['2026-09-01'])).toBe('2026-09')
  })

  it('sem conta de renda não corta nada', () => {
    expect(fullHistoryStart([])).toBeNull()
  })

  it('dezembro passa para janeiro', () => {
    expect(fullHistoryStart(['2025-12-10'])).toBe('2026-01')
  })
})
