import { describe, expect, it } from 'vitest'

import type { ProjectionRecurrence, ProjectionTx } from './projection'
import { loanEndMonth, monthStatus, remainingInstallments } from './recurrence-progress'

describe('remainingInstallments', () => {
  it('sem número informado não há contagem', () => {
    expect(remainingInstallments({ remainingInstallments: null, remainingAsOf: null, linkedDates: ['2026-10-05'] })).toBeNull()
  })

  it('desconta só as parcelas vinculadas depois do dia em que foi informado', () => {
    const linkedDates = ['2026-09-05', '2026-10-05', '2026-11-05']
    expect(remainingInstallments({ remainingInstallments: 8, remainingAsOf: '2026-10-05', linkedDates })).toBe(7)
  })

  it('não fica negativo', () => {
    expect(remainingInstallments({ remainingInstallments: 1, remainingAsOf: '2026-01-01', linkedDates: ['2026-02-01', '2026-03-01'] })).toBe(0)
  })
})

describe('loanEndMonth', () => {
  it('termina no mês da última parcela, contando a deste mês se ainda não foi paga', () => {
    expect(loanEndMonth('2026-10-31', 8, false)).toBe('2027-05')
    expect(loanEndMonth('2026-10-31', 8, true)).toBe('2027-06')
    expect(loanEndMonth('2026-12-10', 1, false)).toBe('2026-12')
  })

  it('sem parcelas restantes não há término', () => {
    expect(loanEndMonth('2026-10-31', 0, false)).toBeNull()
  })
})

describe('monthStatus', () => {
  const rent: ProjectionRecurrence = {
    id: 'rent',
    accountId: 'bank',
    accountType: 'BANK',
    direction: 'OUT',
    description: 'Aluguel',
    descriptionKey: 'aluguel',
    expectedAmountCents: 150000,
    dayRule: 'DAY_OF_MONTH',
    dayValue: 15,
    nonBusinessDayPolicy: 'KEEP',
  }
  const paid: ProjectionTx = {
    accountId: 'other',
    date: '2026-10-14',
    amountCents: -150000,
    descriptionKey: 'pix',
    isTransfer: false,
    recurrenceId: 'rent',
  }

  it('pago com a data da transação', () => {
    expect(monthStatus(rent, '2026-10-20', [paid])).toEqual({ state: 'PAID', date: '2026-10-14', days: 0 })
  })

  it('a vencer com os dias que faltam', () => {
    expect(monthStatus(rent, '2026-10-12', [])).toEqual({ state: 'DUE', date: '2026-10-15', days: 3 })
  })

  it('atrasado com os dias de atraso', () => {
    expect(monthStatus(rent, '2026-10-20', [])).toEqual({ state: 'LATE', date: '2026-10-15', days: 5 })
  })

  it('quitado não tem status', () => {
    expect(monthStatus({ ...rent, kind: 'LOAN', paidOff: true }, '2026-10-20', [])).toBeNull()
  })

  it('fora da Pluggy nunca recebe transação: conta como feito na data (pedido do João)', () => {
    const external: ProjectionRecurrence = { ...rent, kind: 'EXTERNAL', direction: 'IN' }
    expect(monthStatus(external, '2026-10-20', [])).toEqual({ state: 'PAID', date: '2026-10-15', days: 0 })
    expect(monthStatus(external, '2026-10-15', [])).toEqual({ state: 'PAID', date: '2026-10-15', days: 0 })
    expect(monthStatus(external, '2026-10-12', [])).toEqual({ state: 'DUE', date: '2026-10-15', days: 3 })
  })
})
