import { describe, expect, it } from 'vitest'

import { payrollCreditIds, pickPayrollSource } from './payroll'
import type { ProjectionRecurrence, ProjectionTx } from './projection'

const salary: ProjectionRecurrence = {
  id: 'salary',
  accountId: 'caixa',
  accountType: 'BANK',
  direction: 'IN',
  description: 'RECEBIMENTO TED SALARIO',
  descriptionKey: 'recebimento ted salario',
  expectedAmountCents: 297000,
  dayRule: 'NTH_BUSINESS_DAY',
  dayValue: 4,
  nonBusinessDayPolicy: 'ANTICIPATE',
}
const voucher: ProjectionRecurrence = {
  ...salary,
  id: 'voucher',
  expectedAmountCents: 168900,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 20,
}
const rent: ProjectionRecurrence = { ...salary, id: 'rental', descriptionKey: 'aluguel recebido', expectedAmountCents: 900000 }

describe('pickPayrollSource', () => {
  it('usa o recebimento escolhido', () => {
    expect(pickPayrollSource('voucher', [salary, voucher])?.id).toBe('voucher')
  })

  it('sem escolha (ou escolhido que não é mais recebimento), vale o salário de maior valor', () => {
    expect(pickPayrollSource(null, [voucher, rent, salary])?.id).toBe('salary')
    expect(pickPayrollSource('gone', [voucher, salary])?.id).toBe('salary')
  })

  it('sem salário, o maior recebimento; sem nenhum, nada', () => {
    expect(pickPayrollSource(null, [{ ...rent, descriptionKey: 'pix' }])?.id).toBe('rental')
    expect(pickPayrollSource(null, [])).toBeNull()
  })
})

describe('payrollCreditIds', () => {
  const tx = (id: string, date: string, extra: Partial<ProjectionTx> = {}) => ({
    id,
    accountId: 'caixa',
    date,
    amountCents: 297000,
    descriptionKey: 'recebimento ted salario',
    isTransfer: false,
    recurrenceId: null,
    ...extra,
  })

  it('o crédito que cumpre cada ocorrência do salário desde o início, um por mês', () => {
    const txs = [
      tx('sep', '2026-09-04'),
      tx('oct', '2026-10-06'),
      tx('oct-vale', '2026-10-20', { amountCents: 168900 }),
      tx('pix', '2026-10-07', { descriptionKey: 'pix', amountCents: 5000 }),
    ]
    expect(payrollCreditIds(salary, txs, '2026-10-01', '2026-10-31')).toEqual(['oct'])
  })

  it('o crédito vinculado à mão ao salário vale, mesmo com outro texto', () => {
    const txs = [tx('linked', '2026-10-06', { descriptionKey: 'ted', amountCents: 250000, recurrenceId: 'salary' })]
    expect(payrollCreditIds(salary, txs, '2026-10-01', '2026-10-31')).toEqual(['linked'])
  })

  it('crédito do vale (outro recorrente) não conta para o salário', () => {
    const txs = [tx('vale', '2026-10-06', { recurrenceId: 'voucher' })]
    expect(payrollCreditIds(salary, txs, '2026-10-01', '2026-10-31')).toEqual([])
  })
})
