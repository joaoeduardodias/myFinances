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

const { getCards } = await import('./get-cards')
const { updateCardCycle } = await import('./update-card-cycle')

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
  closingDay: null,
  dueDay: null,
}
const card = { ...bank, id: cardId, type: 'CREDIT', name: 'Nubank', number: '9876', balanceCents: -80000, closingDay: 27, dueDay: 3 }
const noCycle = { ...card, id: noCycleId, name: 'Inter', closingDay: null, dueDay: null }

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'PATCH'; url: string; body?: unknown },
) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: authHeaders(token),
    ...(opts.body ? { payload: opts.body as object } : {}),
  })
}

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
  prismaMock.recurrence.findMany.mockResolvedValue([])
})

describe('autenticação', () => {
  it('exige token nas rotas de cartões', async () => {
    const cases = [
      [getCards, 'GET', '/cards', undefined],
      [updateCardCycle, 'PATCH', `/cards/${cardId}`, { closingDay: 27, dueDay: 3 }],
    ] as const
    for (const [plugin, method, url, payload] of cases) {
      const app = await buildTestApp(plugin)
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) })
      expect(response.statusCode).toBe(401)
    }
  })
})

describe('GET /cards', () => {
  it('lista os cartões com ciclo e as faturas de cada um', async () => {
    const response = await call(getCards, { method: 'GET', url: '/cards' })

    expect(response.statusCode).toBe(200)
    const { cards, cardsMissingCycle } = response.json()
    expect(cardsMissingCycle).toEqual([{ id: noCycleId, name: 'Inter' }])
    expect(cards).toHaveLength(1)
    expect(cards[0].account).toEqual({
      id: cardId,
      name: 'Nubank',
      number: '9876',
      balanceCents: -80000,
      closingDay: 27,
      dueDay: 3,
    })
    const open = cards[0].bills.find((b: { status: string }) => b.status === 'OPEN')
    expect(open).toMatchObject({
      accountId: cardId,
      closeDate: '2026-10-27',
      dueDate: '2026-11-03',
      amountCents: 80000,
      remainingCents: 80000,
    })
    expect(open.transactions).toEqual([
      {
        date: '2026-10-10',
        amountCents: -80000,
        isTransfer: false,
        installmentNumber: null,
        totalInstallments: null,
        description: 'MERCADO',
      },
    ])
  })
})

describe('PATCH /cards/:accountId', () => {
  it('grava o ciclo do cartão do usuário', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: cardId })
    prismaMock.account.update.mockResolvedValue({ ...card, closingDay: 20, dueDay: 28 })

    const response = await call(updateCardCycle, {
      method: 'PATCH',
      url: `/cards/${cardId}`,
      body: { closingDay: 20, dueDay: 28 },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().account).toMatchObject({ id: cardId, closingDay: 20, dueDay: 28 })
    expect(prismaMock.account.update.mock.calls[0][0]).toMatchObject({
      where: { id: cardId },
      data: { closingDay: 20, dueDay: 28 },
    })
  })

  it('devolve 404 para conta que não é cartão do usuário', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null)

    const response = await call(updateCardCycle, {
      method: 'PATCH',
      url: `/cards/${bankId}`,
      body: { closingDay: 20, dueDay: 28 },
    })

    expect(response.statusCode).toBe(404)
    expect(prismaMock.account.findFirst.mock.calls[0][0].where).toEqual({
      id: bankId,
      userId: userA,
      type: 'CREDIT',
    })
    expect(prismaMock.account.update).not.toHaveBeenCalled()
  })

  it('recusa dia fora de 1 a 31', async () => {
    for (const body of [{ closingDay: 32, dueDay: 3 }, { closingDay: 27, dueDay: 0 }]) {
      const response = await call(updateCardCycle, { method: 'PATCH', url: `/cards/${cardId}`, body })
      expect(response.statusCode).toBe(400)
    }
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled()
  })
})
