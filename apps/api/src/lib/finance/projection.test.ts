import { describe, expect, it } from 'vitest'

import type { CardBillView } from './card-bills'
import {
  computeProjection,
  isOccurrenceMatched,
  type ProjectionRecurrence,
  type ProjectionTx,
} from './projection'

const bank = { id: 'bank', type: 'BANK', balanceCents: 300000 } as const

const salary: ProjectionRecurrence = {
  id: 'salary',
  accountId: 'bank',
  accountType: 'BANK',
  direction: 'IN',
  description: 'Salário',
  descriptionKey: 'salario empresa',
  expectedAmountCents: 500000,
  dayRule: 'NTH_BUSINESS_DAY',
  dayValue: 5,
  nonBusinessDayPolicy: 'ANTICIPATE',
}

const voucher: ProjectionRecurrence = {
  id: 'voucher',
  accountId: 'bank',
  accountType: 'BANK',
  direction: 'IN',
  description: 'Vale',
  descriptionKey: 'adiantamento empresa',
  expectedAmountCents: 200000,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 20,
  nonBusinessDayPolicy: 'ANTICIPATE',
}

const rent: ProjectionRecurrence = {
  id: 'rent',
  accountId: 'bank',
  accountType: 'BANK',
  direction: 'OUT',
  description: 'Aluguel',
  descriptionKey: 'aluguel',
  expectedAmountCents: 150000,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 1,
  nonBusinessDayPolicy: 'ANTICIPATE',
}

const netflix: ProjectionRecurrence = {
  id: 'netflix',
  accountId: 'card',
  accountType: 'CREDIT',
  direction: 'OUT',
  description: 'Netflix',
  descriptionKey: 'netflix',
  expectedAmountCents: 5590,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 28,
  nonBusinessDayPolicy: 'KEEP',
}

const voucherPaid: ProjectionTx = {
  accountId: 'bank',
  date: '2026-10-20',
  amountCents: 200000,
  descriptionKey: 'adiantamento empresa',
  isTransfer: false,
}

const bill: CardBillView = {
  accountId: 'card',
  closeDate: '2026-10-27',
  dueDate: '2026-11-03',
  amountCents: 80000,
  paidCents: 0,
  remainingCents: 80000,
  status: 'OPEN',
  transactions: [],
}

const baseInput = {
  today: '2026-10-25',
  accounts: [bank],
  recurrences: [salary, voucher, rent],
  transactions: [voucherPaid],
  cardBills: [bill],
  cardNames: { card: 'Nubank' },
}

describe('computeProjection', () => {
  it('projeta até o salário, com o vale já caído', () => {
    const projection = computeProjection(baseInput)

    expect(projection.balanceCents).toBe(300000)
    expect(projection.nextIncome).toEqual({
      recurrenceId: 'salary',
      description: 'Salário',
      date: '2026-11-09',
      amountCents: 500000,
    })
    expect(projection.windowEnd).toBe('2026-11-09')
    expect(projection.noIncomeConfigured).toBe(false)
    // 01/11/2026 é domingo e o sábado 31/10 também não é útil: antecipa para 30/10.
    expect(projection.payables).toEqual([
      { kind: 'RECURRENCE', refId: 'rent', description: 'Aluguel', dueDate: '2026-10-30', amountCents: 150000 },
      { kind: 'BILL', refId: 'card:2026-11-03', description: 'Fatura Nubank', dueDate: '2026-11-03', amountCents: 80000 },
    ])
    expect(projection.payableTotalCents).toBe(230000)
    expect(projection.availableCents).toBe(70000)
    expect(projection.days).toBe(15)
    expect(projection.perDayCents).toBe(4666)
  })

  it('não cobra à parte o recorrente de cartão, que já está na fatura', () => {
    const projection = computeProjection({ ...baseInput, recurrences: [...baseInput.recurrences, netflix] })

    expect(projection.payables.map((p) => p.refId)).toEqual(['rent', 'card:2026-11-03'])
    expect(projection.availableCents).toBe(70000)
  })

  it('tira o aluguel já pago dos payables', () => {
    const rentPaid: ProjectionTx = {
      accountId: 'bank',
      date: '2026-10-30',
      amountCents: -150000,
      descriptionKey: 'pix joao silva',
      isTransfer: false,
    }
    const projection = computeProjection({
      ...baseInput,
      today: '2026-10-31',
      transactions: [voucherPaid, rentPaid],
    })

    expect(projection.payables).toEqual([
      { kind: 'BILL', refId: 'card:2026-11-03', description: 'Fatura Nubank', dueDate: '2026-11-03', amountCents: 80000 },
    ])
    expect(projection.nextIncome?.date).toBe('2026-11-09')
  })

  it('vai até o fim do mês sem recorrente de entrada', () => {
    const projection = computeProjection({ ...baseInput, recurrences: [rent] })

    expect(projection.nextIncome).toBeNull()
    expect(projection.noIncomeConfigured).toBe(true)
    expect(projection.windowEnd).toBe('2026-10-31')
    expect(projection.days).toBe(6)
    // O vencimento da fatura (03/11) fica fora da janela.
    expect(projection.payables.map((p) => p.refId)).toEqual(['rent'])
    expect(projection.availableCents).toBe(150000)
    expect(projection.perDayCents).toBe(25000)
  })

  it('usa um dia quando o salário é previsto para hoje e ainda não caiu', () => {
    const projection = computeProjection({
      ...baseInput,
      today: '2026-11-09',
      recurrences: [salary],
      transactions: [],
      cardBills: [],
    })

    expect(projection.nextIncome?.date).toBe('2026-11-09')
    expect(projection.days).toBe(1)
    expect(projection.perDayCents).toBe(projection.availableCents)
    expect(projection.availableCents).toBe(300000)
  })

  it('traz para hoje o salário atrasado', () => {
    const projection = computeProjection({
      ...baseInput,
      today: '2026-11-11',
      recurrences: [salary],
      transactions: [],
      cardBills: [],
    })

    expect(projection.nextIncome?.date).toBe('2026-11-11')
    expect(projection.windowEnd).toBe('2026-11-11')
    expect(projection.days).toBe(1)
  })

  it('pula o salário que já caiu e mira o do mês seguinte', () => {
    const projection = computeProjection({
      ...baseInput,
      today: '2026-11-10',
      recurrences: [salary],
      transactions: [
        { accountId: 'bank', date: '2026-11-09', amountCents: 498000, descriptionKey: 'ted recebida', isTransfer: false },
      ],
      cardBills: [],
    })

    expect(projection.nextIncome?.date).toBe('2026-12-07')
  })

  it('deixa o disponível negativo quando falta dinheiro', () => {
    const projection = computeProjection({
      ...baseInput,
      accounts: [{ ...bank, balanceCents: 10000 }],
      recurrences: [salary, voucher],
      cardBills: [{ ...bill, amountCents: 50000, remainingCents: 50000 }],
    })

    expect(projection.payableTotalCents).toBe(50000)
    expect(projection.availableCents).toBe(-40000)
    expect(projection.perDayCents).toBe(Math.trunc(-40000 / 15))
    expect(projection.perDayCents).toBeLessThan(0)
  })

  it('soma só contas BANK e WALLET no saldo', () => {
    const projection = computeProjection({
      ...baseInput,
      accounts: [
        bank,
        { id: 'wallet', type: 'WALLET', balanceCents: 5000 },
        { id: 'card', type: 'CREDIT', balanceCents: -90000 },
      ],
    })

    expect(projection.balanceCents).toBe(305000)
  })

  it('usa o restante da fatura e ignora a quitada ou depois da janela', () => {
    const projection = computeProjection({
      ...baseInput,
      cardBills: [
        { ...bill, paidCents: 30000, remainingCents: 50000 },
        { ...bill, dueDate: '2026-10-03', status: 'CLOSED', remainingCents: 0 },
        { ...bill, dueDate: '2026-12-03', status: 'FUTURE' },
      ],
    })

    expect(projection.payables.filter((p) => p.kind === 'BILL')).toEqual([
      { kind: 'BILL', refId: 'card:2026-11-03', description: 'Fatura Nubank', dueDate: '2026-11-03', amountCents: 50000 },
    ])
  })

  it('mantém a fatura vencida e não paga, por mais antiga que seja', () => {
    const projection = computeProjection({
      ...baseInput,
      cardBills: [bill, { ...bill, dueDate: '2026-09-03', status: 'CLOSED', remainingCents: 2409 }],
    })

    expect(projection.payables.filter((p) => p.kind === 'BILL')).toEqual([
      { kind: 'BILL', refId: 'card:2026-09-03', description: 'Fatura Nubank', dueDate: '2026-09-03', amountCents: 2409 },
      { kind: 'BILL', refId: 'card:2026-11-03', description: 'Fatura Nubank', dueDate: '2026-11-03', amountCents: 80000 },
    ])
  })

  it('mantém o recorrente vencido há até 5 dias e ainda não pago', () => {
    const projection = computeProjection({ ...baseInput, today: '2026-11-03' })

    expect(projection.payables[0]).toEqual({
      kind: 'RECURRENCE',
      refId: 'rent',
      description: 'Aluguel',
      dueDate: '2026-10-30',
      amountCents: 150000,
    })
  })

  it('identifica cada fatura pelo vencimento e usa nome genérico sem o do cartão', () => {
    const projection = computeProjection({
      ...baseInput,
      recurrences: [salary],
      cardNames: undefined,
      cardBills: [bill, { ...bill, dueDate: '2026-11-05' }],
    })

    expect(projection.payables).toEqual([
      { kind: 'BILL', refId: 'card:2026-11-03', description: 'Fatura do cartão', dueDate: '2026-11-03', amountCents: 80000 },
      { kind: 'BILL', refId: 'card:2026-11-05', description: 'Fatura do cartão', dueDate: '2026-11-05', amountCents: 80000 },
    ])
  })

  it('ignora recorrente de entrada em conta de cartão para a janela', () => {
    const cashback: ProjectionRecurrence = { ...voucher, id: 'cashback', accountId: 'card', accountType: 'CREDIT', dayValue: 27 }
    const projection = computeProjection({ ...baseInput, recurrences: [salary, voucher, rent, cashback] })

    expect(projection.nextIncome?.recurrenceId).toBe('salary')
  })
})

describe('isOccurrenceMatched', () => {
  const tx = (overrides: Partial<ProjectionTx>): ProjectionTx => ({ ...voucherPaid, ...overrides })

  it('casa pela chave da descrição mesmo com valor diferente', () => {
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ amountCents: 120000 })])).toBe(true)
  })

  it('casa pelo valor a até 10% mesmo com descrição diferente', () => {
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ descriptionKey: 'pix', amountCents: 180000 })])).toBe(true)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ descriptionKey: 'pix', amountCents: 220000 })])).toBe(true)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ descriptionKey: 'pix', amountCents: 179999 })])).toBe(false)
  })

  it('aceita até 5 dias de distância da data esperada', () => {
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ date: '2026-10-15' })])).toBe(true)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ date: '2026-10-25' })])).toBe(true)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ date: '2026-10-14' })])).toBe(false)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ date: '2026-10-26' })])).toBe(false)
  })

  it('exige o sinal da direção, a mesma conta e que não seja transferência', () => {
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ amountCents: -200000 })])).toBe(false)
    expect(isOccurrenceMatched(rent, '2026-10-30', [tx({ date: '2026-10-30', descriptionKey: 'aluguel', amountCents: 150000 })])).toBe(false)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ accountId: 'other' })])).toBe(false)
    expect(isOccurrenceMatched(voucher, '2026-10-20', [tx({ isTransfer: true })])).toBe(false)
  })
})
