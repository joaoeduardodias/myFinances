import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { loadFinanceSnapshot } = await import('./load-finance-snapshot')

const USER = 'user-1'
const TODAY = '2026-10-25'

const bank = {
  id: 'bank',
  type: 'BANK',
  name: 'Itaú',
  number: '1234',
  balanceCents: 300000,
  closingDay: null,
  dueDay: null,
}
const card = { ...bank, id: 'card', type: 'CREDIT', name: 'Nubank', balanceCents: -80000, closingDay: 27, dueDay: 3 }
const noCycle = { ...card, id: 'no-cycle', name: 'Inter', closingDay: 27, dueDay: null }

const txRow = (accountId: string, date: string, amountCents: number) => ({
  accountId,
  date: new Date(`${date}T00:00:00Z`),
  amountCents,
  description: 'COMPRA',
  descriptionKey: 'compra',
  isTransfer: false,
  installmentNumber: null,
  totalInstallments: null,
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.account.findMany.mockResolvedValue([bank, card, noCycle])
  prismaMock.transaction.findMany.mockResolvedValue([
    txRow('card', '2026-10-10', -80000),
    txRow('no-cycle', '2026-10-11', -1000),
    txRow('bank', '2026-10-20', 200000),
  ])
  prismaMock.cardBill.findMany.mockResolvedValue([
    { accountId: 'card', dueDate: new Date('2026-11-03T00:00:00Z'), totalCents: 81000, paidCents: 0 },
  ])
  prismaMock.recurrence.findMany.mockResolvedValue([
    {
      id: 'rent',
      accountId: 'bank',
      description: 'Aluguel',
      descriptionKey: 'aluguel',
      direction: 'OUT',
      expectedAmountCents: 150000,
      dayRule: 'DAY_OF_MONTH',
      dayValue: 30,
      nonBusinessDayPolicy: 'KEEP',
      account: { type: 'BANK' },
    },
  ])
})

describe('loadFinanceSnapshot', () => {
  it('separa o cartão sem ciclo e calcula as faturas só dos que têm', async () => {
    const snapshot = await loadFinanceSnapshot(USER, TODAY)

    expect(snapshot.cardsMissingCycle).toEqual([{ id: 'no-cycle', name: 'Inter' }])
    expect(new Set(snapshot.cardBills.map((b) => b.accountId))).toEqual(new Set(['card']))
    const open = snapshot.cardBills.find((b) => b.status === 'OPEN')
    expect(open).toMatchObject({ dueDate: '2026-11-03', amountCents: 81000 })
    expect(open?.transactions).toEqual([
      {
        date: '2026-10-10',
        amountCents: -80000,
        isTransfer: false,
        installmentNumber: null,
        totalInstallments: null,
        description: 'COMPRA',
      },
    ])
    expect(snapshot.accounts).toHaveLength(3)
  })

  it('busca só do usuário, 400 dias para cada lado e só recorrentes confirmados', async () => {
    const snapshot = await loadFinanceSnapshot(USER, TODAY)

    expect(prismaMock.account.findMany.mock.calls[0][0].where).toEqual({ userId: USER })
    expect(prismaMock.cardBill.findMany.mock.calls[0][0].where).toEqual({ userId: USER })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      date: { gte: new Date('2025-09-20T00:00:00Z'), lte: new Date('2027-11-29T00:00:00Z') },
    })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      status: 'CONFIRMED',
    })
    expect(snapshot.recurrences).toEqual([
      {
        id: 'rent',
        accountId: 'bank',
        accountType: 'BANK',
        description: 'Aluguel',
        descriptionKey: 'aluguel',
        direction: 'OUT',
        expectedAmountCents: 150000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 30,
        nonBusinessDayPolicy: 'KEEP',
      },
    ])
    expect(snapshot.transactions[2]).toEqual({
      accountId: 'bank',
      date: '2026-10-20',
      amountCents: 200000,
      descriptionKey: 'compra',
      isTransfer: false,
    })
  })
})
