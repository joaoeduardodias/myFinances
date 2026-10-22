import { describe, expect, it } from 'vitest'

import { type CardTx, computeCardBills } from './card-bills'

function tx(date: string, amountCents: number, extra: Partial<CardTx> = {}): CardTx {
  return { date, amountCents, isTransfer: false, description: 'compra', ...extra }
}

const base = {
  accountId: 'card-1',
  closingDay: 3,
  dueDay: 10,
  pluggyBills: [],
  today: '2026-10-01',
}

function billDue(bills: ReturnType<typeof computeCardBills>, dueDate: string) {
  const bill = bills.find((b) => b.dueDate === dueDate)
  if (!bill) throw new Error(`sem fatura com vencimento ${dueDate}`)
  return bill
}

describe('computeCardBills', () => {
  it('põe a compra antes do fechamento na fatura aberta', () => {
    const bills = computeCardBills({ ...base, transactions: [tx('2026-09-25', -10000)] })
    const october = billDue(bills, '2026-10-10')
    expect(october).toMatchObject({
      accountId: 'card-1',
      closeDate: '2026-10-03',
      status: 'OPEN',
      amountCents: 10000,
      paidCents: 0,
      remainingCents: 10000,
    })
    expect(october.transactions).toHaveLength(1)
  })

  it('põe a compra depois do fechamento na fatura seguinte, futura', () => {
    const bills = computeCardBills({ ...base, transactions: [tx('2026-10-05', -5000)] })
    expect(billDue(bills, '2026-11-10')).toMatchObject({
      closeDate: '2026-11-03',
      status: 'FUTURE',
      amountCents: 5000,
    })
    expect(billDue(bills, '2026-10-10').amountCents).toBe(0)
  })

  it('conta o pagamento feito depois do fechamento na fatura fechada', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [
        tx('2026-09-25', -10000),
        tx('2026-10-08', 10000, { isTransfer: true, description: 'pagamento' }),
      ],
    })
    const october = billDue(bills, '2026-10-10')
    expect(october.paidCents).toBe(10000)
    expect(october.remainingCents).toBe(0)
    // O pagamento não entra como estorno em nenhuma fatura.
    expect(bills.map((b) => b.amountCents)).toEqual([0, 10000])
  })

  it('abate o estorno do valor da fatura', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [tx('2026-09-25', -10000), tx('2026-09-28', 2000, { description: 'estorno' })],
    })
    expect(billDue(bills, '2026-10-10').amountCents).toBe(8000)
  })

  it('usa o total da fatura da Pluggy com vencimento até 3 dias do calculado', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [
        tx('2026-09-25', -10000),
        tx('2026-10-08', 3000, { isTransfer: true, description: 'pagamento' }),
      ],
      pluggyBills: [{ dueDate: '2026-10-11', totalCents: 12345, paidCents: 1000 }],
    })
    const october = billDue(bills, '2026-10-10')
    expect(october.amountCents).toBe(12345)
    expect(october.paidCents).toBe(3000)
    expect(october.remainingCents).toBe(9345)
  })

  it('ignora fatura da Pluggy com vencimento a mais de 3 dias', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [tx('2026-09-25', -10000)],
      pluggyBills: [{ dueDate: '2026-10-14', totalCents: 12345, paidCents: 20000 }],
    })
    expect(billDue(bills, '2026-10-10')).toMatchObject({ amountCents: 10000, paidCents: 0 })
  })

  it('prefere o pago da Pluggy quando é maior que o calculado', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [tx('2026-09-25', -10000)],
      pluggyBills: [{ dueDate: '2026-10-07', totalCents: 10000, paidCents: 4000 }],
    })
    expect(billDue(bills, '2026-10-10')).toMatchObject({ paidCents: 4000, remainingCents: 6000 })
  })

  it('cria a fatura da parcela futura e as vazias entre elas', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [
        tx('2026-12-20', -3000, { installmentNumber: 3, totalInstallments: 3 }),
      ],
    })
    expect(bills.map((b) => b.dueDate)).toEqual([
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
    ])
    expect(billDue(bills, '2027-01-10')).toMatchObject({ amountCents: 3000, status: 'FUTURE' })
  })

  it('começa da última fechada e marca o status de cada fatura', () => {
    const bills = computeCardBills({
      ...base,
      transactions: [tx('2026-08-02', -1000), tx('2026-09-02', -2000)],
    })
    expect(bills.map((b) => [b.dueDate, b.status, b.amountCents])).toEqual([
      ['2026-09-10', 'CLOSED', 2000],
      ['2026-10-10', 'OPEN', 0],
    ])
  })

  it('para em 12 faturas depois da aberta', () => {
    const bills = computeCardBills({ ...base, transactions: [tx('2028-06-15', -1000)] })
    expect(bills).toHaveLength(14)
    expect(bills.at(-1)?.dueDate).toBe('2027-10-10')
  })

  it('fecha no mês anterior quando o fechamento não é antes do vencimento', () => {
    const bills = computeCardBills({
      ...base,
      closingDay: 28,
      dueDay: 5,
      transactions: [tx('2026-10-28', -1000), tx('2026-10-29', -2000)],
    })
    expect(billDue(bills, '2026-11-05')).toMatchObject({
      closeDate: '2026-10-28',
      status: 'OPEN',
      amountCents: 1000,
    })
    expect(billDue(bills, '2026-12-05')).toMatchObject({
      closeDate: '2026-11-28',
      amountCents: 2000,
    })
  })

  it('limita o dia de fechamento e de vencimento ao fim do mês', () => {
    const bills = computeCardBills({
      ...base,
      closingDay: 31,
      dueDay: 30,
      today: '2027-02-10',
      transactions: [tx('2027-02-28', -1000), tx('2027-03-01', -2000)],
    })
    expect(billDue(bills, '2027-03-30')).toMatchObject({ closeDate: '2027-02-28', amountCents: 1000 })
    expect(billDue(bills, '2027-04-30')).toMatchObject({ closeDate: '2027-03-31', amountCents: 2000 })
    expect(billDue(bills, '2027-02-28').closeDate).toBe('2027-01-31')
  })

  it('marca como fechada a fatura no dia seguinte ao fechamento', () => {
    const onClose = computeCardBills({ ...base, today: '2026-10-03', transactions: [] })
    expect(billDue(onClose, '2026-10-10').status).toBe('OPEN')
    const after = computeCardBills({ ...base, today: '2026-10-04', transactions: [] })
    expect(billDue(after, '2026-10-10').status).toBe('CLOSED')
    expect(billDue(after, '2026-11-10').status).toBe('OPEN')
  })
})
