import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { syncPayrollLinks } = await import('./sync-payroll-links')

const USER = 'user-1'
const TODAY = '2026-10-31'

const income = (id: string, expectedAmountCents: number, dayRule: string, dayValue: number) => ({
  id,
  accountId: 'caixa',
  description: 'RECEBIMENTO TED SALARIO',
  descriptionKey: 'recebimento ted salario',
  direction: 'IN',
  expectedAmountCents,
  dayRule,
  dayValue,
  nonBusinessDayPolicy: 'ANTICIPATE',
  kind: 'MONTHLY',
  status: 'CONFIRMED',
  remainingInstallments: null,
  remainingAsOf: null,
  payrollDeduction: false,
  transactions: [],
  payrollLinks: [],
  account: { type: 'BANK' },
})

const credit = (id: string, date: string, amountCents: number) => ({
  id,
  accountId: 'caixa',
  date: new Date(`${date}T00:00:00Z`),
  amountCents,
  descriptionKey: 'recebimento ted salario',
  isTransfer: false,
  recurrenceId: null,
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.recurrence.findMany.mockImplementation(async (args: { where: { payrollDeduction?: boolean } }) =>
    args.where.payrollDeduction
      ? [
          {
            id: 'loan',
            payrollSourceId: null,
            createdAt: new Date('2026-10-31T12:00:00Z'),
            linkDismissals: [],
          },
        ]
      : [income('salary', 297000, 'NTH_BUSINESS_DAY', 4), income('voucher', 168900, 'DAY_OF_MONTH', 20)],
  )
  prismaMock.transaction.findMany.mockResolvedValue([
    credit('sep', '2026-09-04', 297000),
    credit('oct', '2026-10-06', 297000),
    credit('oct-vale', '2026-10-20', 168900),
  ])
  prismaMock.recurrencePayrollLink.createMany.mockImplementation(async ({ data }) => ({ count: data.length }))
})

describe('syncPayrollLinks', () => {
  it('vincula o salário principal do mês em que o empréstimo foi cadastrado em diante', async () => {
    const created = await syncPayrollLinks(USER, TODAY)

    expect(created).toBe(1)
    expect(prismaMock.recurrencePayrollLink.createMany).toHaveBeenCalledWith({
      data: [{ recurrenceId: 'loan', transactionId: 'oct' }],
      skipDuplicates: true,
    })
    // Empréstimo ou saída mensal: todo desconto em folha.
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      payrollDeduction: true,
      status: 'CONFIRMED',
    })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      isTransfer: false,
      amountCents: { gt: 0 },
      date: { gte: new Date('2026-09-26T00:00:00Z') },
    })
  })

  it('usa o recebimento escolhido no empréstimo', async () => {
    prismaMock.recurrence.findMany.mockImplementation(async (args: { where: { payrollDeduction?: boolean } }) =>
      args.where.payrollDeduction
        ? [{ id: 'loan', payrollSourceId: 'voucher', createdAt: new Date('2026-10-01T12:00:00Z'), linkDismissals: [] }]
        : [income('salary', 297000, 'NTH_BUSINESS_DAY', 4), income('voucher', 168900, 'DAY_OF_MONTH', 20)],
    )
    await syncPayrollLinks(USER, TODAY)
    expect(prismaMock.recurrencePayrollLink.createMany.mock.calls[0][0].data).toEqual([
      { recurrenceId: 'loan', transactionId: 'oct-vale' },
    ])
  })

  it('não volta a vincular o que o João desvinculou', async () => {
    prismaMock.recurrence.findMany.mockImplementation(async (args: { where: { payrollDeduction?: boolean } }) =>
      args.where.payrollDeduction
        ? [
            {
              id: 'loan',
              payrollSourceId: null,
              createdAt: new Date('2026-10-01T12:00:00Z'),
              linkDismissals: [{ transactionId: 'oct' }],
            },
          ]
        : [income('salary', 297000, 'NTH_BUSINESS_DAY', 4)],
    )
    expect(await syncPayrollLinks(USER, TODAY)).toBe(0)
    expect(prismaMock.recurrencePayrollLink.createMany).not.toHaveBeenCalled()
  })

  it('sem empréstimo em folha não lê transações', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([])
    expect(await syncPayrollLinks(USER, TODAY)).toBe(0)
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled()
  })
})
