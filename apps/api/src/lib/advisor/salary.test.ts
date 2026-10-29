import { describe, expect, it } from 'vitest'

import { salaryByMonth } from './salary'

const salary = { accountId: 'caixa', descriptionKey: 'recebimento ted salario', expectedAmountCents: 297000 }
const vale = { accountId: 'caixa', descriptionKey: 'recebimento ted salario', expectedAmountCents: 168900 }

function credit(date: string, amountCents: number, extra: Partial<{ accountId: string; descriptionKey: string }> = {}) {
  return { accountId: 'caixa', descriptionKey: 'recebimento ted salario', date, amountCents, ...extra }
}

describe('salaryByMonth', () => {
  it('um crédito por recorrência por mês, o mais próximo do esperado; o extra fica de fora', () => {
    const result = salaryByMonth(
      [credit('2026-10-06', 297000), credit('2026-10-20', 168900), credit('2026-10-20', 257700)],
      [salary, vale],
    )
    expect(result.get('2026-10')).toBe(465900)
  })

  it('ignora crédito de outra conta ou outra descrição', () => {
    const result = salaryByMonth(
      [credit('2026-09-04', 297000, { accountId: 'nubank' }), credit('2026-09-05', 297000, { descriptionKey: 'pix' })],
      [salary],
    )
    expect(result.get('2026-09')).toBeUndefined()
  })

  it('mês sem um dos pagamentos soma só o que veio', () => {
    expect(salaryByMonth([credit('2026-08-06', 297000)], [salary, vale]).get('2026-08')).toBe(297000)
  })
})
