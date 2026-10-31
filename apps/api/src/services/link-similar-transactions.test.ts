import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { linkSimilarTransactions } = await import('./link-similar-transactions')

const USER = 'user-1'
const TODAY = '2026-10-31'

const tx = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
  id,
  date: new Date(`${date}T00:00:00Z`),
  amountCents: -154602,
  descriptionKey: 'efetuado banco c s a',
  isTransfer: false,
  recurrenceId: null,
  ...extra,
})

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.recurrence.findMany.mockResolvedValue([
    { id: 'car', transactions: [tx('jul', '2026-07-06', { recurrenceId: 'car' })], linkDismissals: [] },
  ])
  prismaMock.transaction.findMany.mockResolvedValue([
    tx('sep', '2026-09-08'),
    tx('oct', '2026-10-06', { descriptionKey: 'de boleto' }),
  ])
  prismaMock.transaction.updateMany.mockImplementation(async ({ where }) => ({ count: where.id.in.length }))
})

describe('linkSimilarTransactions', () => {
  it('vincula as irmãs das já vinculadas, só se ainda estiverem livres', async () => {
    expect(await linkSimilarTransactions(USER, { today: TODAY })).toBe(2)

    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sep', 'oct'] }, userId: USER, recurrenceId: null },
      data: { recurrenceId: 'car' },
    })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      status: 'CONFIRMED',
      payrollDeduction: false,
      kind: { not: 'EXTERNAL' },
      transactions: { some: {} },
    })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      recurrenceId: null,
      isTransfer: false,
      date: { gte: new Date('2025-10-31T00:00:00Z') },
    })
  })

  it('só os recorrentes pedidos, quando o vínculo é de um só', async () => {
    await linkSimilarTransactions(USER, { today: TODAY, recurrenceIds: ['car'] })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where.id).toEqual({ in: ['car'] })
  })

  it('a mesma transação não vai para dois recorrentes na mesma passada', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([
      { id: 'car', transactions: [tx('jul', '2026-07-06', { recurrenceId: 'car' })], linkDismissals: [] },
      { id: 'twin', transactions: [tx('jul-2', '2026-07-07', { recurrenceId: 'twin' })], linkDismissals: [] },
    ])
    await linkSimilarTransactions(USER, { today: TODAY })
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledTimes(1)
  })

  it('sem recorrente com vínculo não lê transações', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([])
    expect(await linkSimilarTransactions(USER, { today: TODAY })).toBe(0)
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled()
  })
})
