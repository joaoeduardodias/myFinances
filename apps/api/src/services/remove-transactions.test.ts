import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('./wallet', () => ({ recomputeWalletBalance: vi.fn() }))

const { removeTransactions } = await import('./remove-transactions')

const pendente = {
  id: 'tx-1',
  transferPair: null,
  transferPairOf: null,
  userId: 'user-1',
  accountId: 'acc-1',
  date: new Date('2026-10-20'),
  description: 'Almoço',
  descriptionKey: 'almoco',
  amountCents: -3500,
  category: 'Restaurante',
  categoryLocked: true,
  source: 'PLUGGY',
  descriptionLocked: true,
  whatsappMessageId: 'wamid.1',
}

describe('removeTransactions', () => {
  beforeEach(() => {
    resetPrismaMocks(prismaMock)
    prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock))
  })

  it('pendente renomeada pelo WhatsApp volta como manual ao sumir', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([pendente])
    await removeTransactions({ accountId: 'acc-1' })
    expect(prismaMock.transaction.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        accountId: 'acc-1',
        date: pendente.date,
        description: 'Almoço',
        descriptionKey: 'almoco',
        amountCents: -3500,
        category: 'Restaurante',
        categoryLocked: true,
        whatsappMessageId: 'wamid.1',
        source: 'MANUAL',
        status: 'POSTED',
      },
    })
  })

  it('linha sem descrição travada não é recriada', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { ...pendente, descriptionLocked: false },
      { ...pendente, id: 'tx-2', source: 'MANUAL' },
      { ...pendente, id: 'tx-3', whatsappMessageId: null },
    ])
    await removeTransactions({ accountId: 'acc-1' })
    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
  })
})
