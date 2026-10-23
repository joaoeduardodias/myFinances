import { describe, expect, it } from 'vitest'

import { detectRecurrenceCandidates } from './detect-recurrences'

const TODAY = '2026-10-22'

function tx(
  date: string,
  amountCents: number,
  extra: Partial<{ accountId: string; description: string; descriptionKey: string; isTransfer: boolean }> = {},
) {
  return {
    accountId: 'acc-1',
    date,
    amountCents,
    description: 'NETFLIX.COM',
    descriptionKey: 'netflix com',
    isTransfer: false,
    ...extra,
  }
}

const netflix = [tx('2026-08-10', -3990), tx('2026-09-11', -3990), tx('2026-10-10', -3990)]

const salary = ['2026-08-07', '2026-09-08', '2026-10-07'].map((date) =>
  tx(date, 500000, { description: 'SALARIO ACME', descriptionKey: 'salario acme' }),
)

describe('detectRecurrenceCandidates', () => {
  it('sugere DAY_OF_MONTH com a mediana dos dias e do valor', () => {
    expect(detectRecurrenceCandidates(netflix, [], TODAY)).toEqual([
      {
        accountId: 'acc-1',
        descriptionKey: 'netflix com',
        description: 'NETFLIX.COM',
        direction: 'OUT',
        expectedAmountCents: 3990,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 10,
        status: 'SUGGESTED',
      },
    ])
  })

  it('sugere NTH_BUSINESS_DAY para entrada que cai sempre no n-ésimo dia útil', () => {
    const [candidate] = detectRecurrenceCandidates(salary, [], TODAY)
    expect(candidate).toMatchObject({
      direction: 'IN',
      expectedAmountCents: 500000,
      dayRule: 'NTH_BUSINESS_DAY',
      dayValue: 5,
    })
  })

  it('não sugere NTH_BUSINESS_DAY para saída', () => {
    const out = salary.map((t) => ({ ...t, amountCents: -t.amountCents }))
    const [candidate] = detectRecurrenceCandidates(out, [], TODAY)
    expect(candidate).toMatchObject({ direction: 'OUT', dayRule: 'DAY_OF_MONTH', dayValue: 7 })
  })

  it('ignora o que aparece em só 2 meses', () => {
    expect(detectRecurrenceCandidates(netflix.slice(1), [], TODAY)).toEqual([])
  })

  it('ignora valores longe da mediana', () => {
    const txs = [tx('2026-08-10', -10000), tx('2026-09-10', -10000), tx('2026-10-10', -15000)]
    expect(detectRecurrenceCandidates(txs, [], TODAY)).toEqual([])
  })

  it('ignora dias do mês espalhados demais', () => {
    const txs = [tx('2026-08-03', -3990), tx('2026-09-10', -3990), tx('2026-10-10', -3990)]
    expect(detectRecurrenceCandidates(txs, [], TODAY)).toEqual([])
  })

  it('não volta a sugerir um grupo já conhecido, mesmo descartado', () => {
    const known = [
      {
        accountId: 'acc-1',
        descriptionKey: 'netflix com',
        direction: 'OUT' as const,
        dayRule: 'DAY_OF_MONTH' as const,
        dayValue: 25,
      },
    ]
    expect(detectRecurrenceCandidates(netflix, known, TODAY)).toEqual([])
  })

  it('ignora transferências', () => {
    const txs = netflix.map((t) => ({ ...t, isTransfer: true }))
    expect(detectRecurrenceCandidates(txs, [], TODAY)).toEqual([])
  })

  it('ignora descrição sem chave', () => {
    const txs = netflix.map((t) => ({ ...t, descriptionKey: '' }))
    expect(detectRecurrenceCandidates(txs, [], TODAY)).toEqual([])
  })

  it('olha só os últimos 180 dias', () => {
    // 2026-04-24 é today − 181.
    const txs = [tx('2026-04-24', -3990), tx('2026-05-10', -3990), tx('2026-06-10', -3990)]
    expect(detectRecurrenceCandidates(txs, [], TODAY)).toEqual([])
    const inside = [tx('2026-04-25', -3990), tx('2026-05-25', -3990), tx('2026-06-25', -3990)]
    expect(detectRecurrenceCandidates(inside, [], TODAY)).toHaveLength(1)
  })

  it('separa por conta e por sinal', () => {
    const other = netflix.map((t) => ({ ...t, accountId: 'acc-2' }))
    const refunds = netflix.map((t) => ({ ...t, amountCents: 3990 }))
    const result = detectRecurrenceCandidates([...netflix, ...other, ...refunds], [], TODAY)
    expect(result.map((c) => `${c.accountId}:${c.direction}`).sort()).toEqual([
      'acc-1:IN',
      'acc-1:OUT',
      'acc-2:OUT',
    ])
  })

  describe('salário', () => {
    const ted = { description: 'RECEBIMENTO TED SALARIO', descriptionKey: 'recebimento ted salario' }
    // Salário no 4º dia útil; no dia 20, o vale e o 13º, que não se repete.
    const october = [
      tx('2026-10-06', 297000, ted),
      tx('2026-10-20', 257700, ted),
      tx('2026-10-20', 168900, ted),
    ]
    const known = (dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY', dayValue: number) => ({
      accountId: 'acc-1',
      descriptionKey: 'recebimento ted salario',
      direction: 'IN' as const,
      dayRule,
      dayValue,
    })

    it('confirma com um mês só, um recorrente por dia, com o menor valor do dia', () => {
      expect(detectRecurrenceCandidates(october, [], TODAY)).toEqual([
        {
          accountId: 'acc-1',
          descriptionKey: 'recebimento ted salario',
          description: 'RECEBIMENTO TED SALARIO',
          direction: 'IN',
          expectedAmountCents: 297000,
          dayRule: 'NTH_BUSINESS_DAY',
          dayValue: 4,
          status: 'CONFIRMED',
        },
        {
          accountId: 'acc-1',
          descriptionKey: 'recebimento ted salario',
          description: 'RECEBIMENTO TED SALARIO',
          direction: 'IN',
          expectedAmountCents: 168900,
          dayRule: 'DAY_OF_MONTH',
          dayValue: 20,
          status: 'CONFIRMED',
        },
      ])
    })

    it('não recria o do mesmo dia já conhecido, mesmo descartado, mas cria o do outro dia', () => {
      expect(
        detectRecurrenceCandidates(october, [known('NTH_BUSINESS_DAY', 4)], TODAY).map((c) => c.dayValue),
      ).toEqual([20])
      expect(
        detectRecurrenceCandidates(october, [known('DAY_OF_MONTH', 21)], TODAY).map((c) => c.dayValue),
      ).toEqual([4])
    })

    it('não trata saída com "salario" como salário', () => {
      const out = october.map((t) => ({ ...t, amountCents: -t.amountCents }))
      expect(detectRecurrenceCandidates(out, [], TODAY)).toEqual([])
    })
  })
})
