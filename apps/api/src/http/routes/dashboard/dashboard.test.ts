import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/today', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/today')>()),
  todayIso: () => '2026-10-25',
}))

const { getDashboard } = await import('./get-dashboard')

const userA = uuid('user-a')
const bankId = uuid('bank')
const cardId = uuid('card')
const noCycleId = uuid('no-cycle')

const bank = {
  id: bankId,
  type: 'BANK',
  name: 'Itaú',
  number: '1234',
  balanceCents: 300000,
  creditLimitCents: null,
  closingDay: null,
  dueDay: null,
  connectionId: uuid('conn'),
  connection: { institutionCode: '341' },
}
const card = {
  ...bank,
  id: cardId,
  type: 'CREDIT',
  name: 'Nubank',
  balanceCents: -80000,
  creditLimitCents: 100000,
  closingDay: 27,
  dueDay: 3,
}
const noCycle = { ...card, id: noCycleId, name: 'Inter', creditLimitCents: null, dueDay: null }

const recurrence = (fields: Record<string, unknown>) => ({
  accountId: bankId,
  dayRule: 'DAY_OF_MONTH',
  nonBusinessDayPolicy: 'KEEP',
  account: { type: 'BANK' },
  ...fields,
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.account.findMany.mockResolvedValue([bank, card, noCycle])
  prismaMock.transaction.findMany.mockResolvedValue([
    {
      accountId: cardId,
      date: new Date('2026-10-10T00:00:00Z'),
      amountCents: -80000,
      description: 'MERCADO',
      descriptionKey: 'mercado',
      isTransfer: false,
      installmentNumber: null,
      totalInstallments: null,
    },
  ])
  prismaMock.cardBill.findMany.mockResolvedValue([])
  prismaMock.recurrence.findMany.mockResolvedValue([
    recurrence({
      id: 'salary',
      description: 'Salário',
      descriptionKey: 'salario',
      direction: 'IN',
      expectedAmountCents: 500000,
      dayValue: 9,
    }),
    recurrence({
      id: 'rent',
      description: 'Aluguel',
      descriptionKey: 'aluguel',
      direction: 'OUT',
      expectedAmountCents: 150000,
      dayValue: 30,
    }),
  ])
})

describe('GET /dashboard', () => {
  it('exige token', async () => {
    const app = await buildTestApp(getDashboard)
    const response = await app.inject({ method: 'GET', url: '/dashboard' })
    expect(response.statusCode).toBe(401)
  })

  it('devolve o disponível calculado e os cartões sem ciclo', async () => {
    const app = await buildTestApp(getDashboard)
    const token = await signToken(app, { sub: userA })
    const response = await app.inject({ method: 'GET', url: '/dashboard', headers: authHeaders(token) })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.today).toBe('2026-10-25')
    expect(body.balanceCents).toBe(300000)
    expect(body.windowEnd).toBe('2026-11-09')
    expect(body.payables).toEqual([
      { kind: 'RECURRENCE', refId: 'rent', description: 'Aluguel', dueDate: '2026-10-30', amountCents: 150000 },
      { kind: 'BILL', refId: `${cardId}:2026-11-03`, description: 'Fatura Nubank', dueDate: '2026-11-03', amountCents: 80000 },
    ])
    expect(body.payableTotalCents).toBe(230000)
    expect(body.availableCents).toBe(70000)
    expect(body.perDayCents).toBe(4666)
    expect(body.cardsMissingCycle).toEqual([{ id: noCycleId, name: 'Inter' }])
    expect(prismaMock.account.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
  })

  it('devolve as contas por banco e os cartões com o limite', async () => {
    const app = await buildTestApp(getDashboard)
    const token = await signToken(app, { sub: userA })
    const response = await app.inject({ method: 'GET', url: '/dashboard', headers: authHeaders(token) })

    const { banks, cards } = response.json()
    expect(banks).toEqual({
      totalCents: 300000,
      groups: [
        {
          key: '341',
          kind: 'BANK',
          name: 'Itaú',
          logoUrl: null,
          balanceCents: 300000,
          accounts: [{ id: bankId, name: 'Itaú', number: '1234', balanceCents: 300000 }],
        },
      ],
    })
    expect(cards).toMatchObject({ totalCents: -160000, limitCents: 100000, limitUsedCents: -80000 })
    expect(cards.items.map((c: { id: string }) => c.id)).toEqual([cardId, noCycleId])
  })
})
