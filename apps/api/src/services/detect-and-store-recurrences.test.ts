import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { detectAndStoreRecurrences } = await import('./detect-and-store-recurrences')

const USER = 'user-1'
const TODAY = '2026-10-22'

const netflixRows = ['2026-08-10', '2026-09-11', '2026-10-10'].map((date) => ({
  accountId: 'acc-1',
  date: new Date(`${date}T00:00:00Z`),
  amountCents: -3990,
  description: 'NETFLIX.COM',
  descriptionKey: 'netflix com',
  isTransfer: false,
}))

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.transaction.findMany.mockResolvedValue(netflixRows)
  prismaMock.recurrence.findMany.mockResolvedValue([])
  prismaMock.recurrence.createMany.mockImplementation(async ({ data }) => ({ count: data.length }))
})

describe('detectAndStoreRecurrences', () => {
  it('grava os candidatos como SUGGESTED e devolve quantos criou', async () => {
    const created = await detectAndStoreRecurrences(USER, TODAY)

    expect(created).toBe(1)
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: USER,
      isTransfer: false,
      date: { gte: new Date('2026-04-25T00:00:00Z'), lte: new Date('2026-10-22T00:00:00Z') },
    })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({ userId: USER })
    expect(prismaMock.recurrence.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: USER,
          accountId: 'acc-1',
          descriptionKey: 'netflix com',
          description: 'NETFLIX.COM',
          direction: 'OUT',
          expectedAmountCents: 3990,
          dayRule: 'DAY_OF_MONTH',
          dayValue: 10,
          status: 'SUGGESTED',
        },
      ],
      skipDuplicates: true,
    })
  })

  it('depois de descartada, rodar de novo não recria a sugestão', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([
      { accountId: 'acc-1', descriptionKey: 'netflix com', direction: 'OUT', status: 'DISMISSED' },
    ])

    const created = await detectAndStoreRecurrences(USER, TODAY)

    expect(created).toBe(0)
    expect(prismaMock.recurrence.createMany).not.toHaveBeenCalled()
  })
})
