import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()
const recomputeWalletBalance = vi.fn()
const runExclusive = vi.fn((_userId: string, task: () => Promise<unknown>) => task())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/services/wallet', () => ({ recomputeWalletBalance }))
vi.mock('@/services/user-queue', () => ({ runExclusive }))

const { saveWhatsappEntry, undoWhatsappEntry } = await import('./save-entry')

const draft = {
  description: 'Almoço',
  amountCents: -3500,
  date: '2026-10-20',
  category: 'Restaurante' as const,
}
const input = { draft, accountId: 'acc-1', messageId: 'wamid.1' }

const nubank = { id: 'acc-1', name: 'Nubank', type: 'BANK' }
const carteira = { id: 'wallet-1', name: 'Carteira', type: 'WALLET' }

const pluggyRow = {
  id: 'tx-p',
  accountId: 'acc-1',
  amountCents: -3500,
  date: new Date('2026-10-21T00:00:00Z'),
  createdAt: new Date('2026-10-21T10:00:00Z'),
  description: 'PIX ENVIADO RESTAURANTE X',
  originalDescription: null,
}

describe('saveWhatsappEntry', () => {
  beforeEach(() => {
    resetPrismaMocks(prismaMock)
    recomputeWalletBalance.mockReset()
    runExclusive.mockClear()
    prismaMock.account.findFirst.mockResolvedValue(nubank)
    prismaMock.transaction.findMany.mockResolvedValue([])
  })

  it('espera o sync do mesmo usuário', async () => {
    await saveWhatsappEntry('user-1', input)
    expect(runExclusive).toHaveBeenCalledWith('user-1', expect.any(Function))
  })

  it('conta de outro usuário rejeita', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null)
    await expect(saveWhatsappEntry('user-1', input)).rejects.toThrow()
    expect(prismaMock.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acc-1', userId: 'user-1' } }),
    )
    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  it('procura par da Pluggy na conta, com o mesmo valor e na janela', async () => {
    await saveWhatsappEntry('user-1', input)
    expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          accountId: 'acc-1',
          source: 'PLUGGY',
          descriptionLocked: false,
          amountCents: -3500,
          date: {
            gte: new Date('2026-10-17T00:00:00Z'),
            lte: new Date('2026-10-23T00:00:00Z'),
          },
        },
      }),
    )
  })

  it('sem par cria manual com o wamid', async () => {
    prismaMock.transaction.create.mockResolvedValue({ id: 'tx-new' })
    const result = await saveWhatsappEntry('user-1', input)
    expect(result).toEqual({ kind: 'created', accountName: 'Nubank', accountType: 'BANK' })
    expect(prismaMock.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        accountId: 'acc-1',
        date: new Date('2026-10-20T00:00:00Z'),
        description: 'Almoço',
        descriptionKey: 'almoco',
        amountCents: -3500,
        status: 'POSTED',
        source: 'MANUAL',
        whatsappMessageId: 'wamid.1',
        category: 'Restaurante',
        categoryLocked: true,
      },
    })
    expect(recomputeWalletBalance).not.toHaveBeenCalled()
  })

  it('sem categoria não trava categoria', async () => {
    await saveWhatsappEntry('user-1', { ...input, draft: { ...draft, category: null } })
    const data = prismaMock.transaction.create.mock.calls[0][0].data
    expect(data).not.toHaveProperty('category')
    expect(data).not.toHaveProperty('categoryLocked')
  })

  it('na Carteira recalcula o saldo', async () => {
    prismaMock.account.findFirst.mockResolvedValue(carteira)
    const result = await saveWhatsappEntry('user-1', { ...input, accountId: 'wallet-1' })
    expect(result).toEqual({ kind: 'created', accountName: 'Carteira', accountType: 'WALLET' })
    expect(recomputeWalletBalance).toHaveBeenCalledWith('wallet-1')
  })

  it('com par renomeia a transação da Pluggy', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([pluggyRow])
    const result = await saveWhatsappEntry('user-1', input)
    expect(result).toEqual({ kind: 'renamed', accountName: 'Nubank', accountType: 'BANK' })
    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-p' },
      data: {
        originalDescription: 'PIX ENVIADO RESTAURANTE X',
        description: 'Almoço',
        descriptionKey: 'almoco',
        descriptionLocked: true,
        whatsappMessageId: 'wamid.1',
        category: 'Restaurante',
        categoryLocked: true,
      },
    })
  })

  it('ao renomear mantém o texto do banco que já estava guardado', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { ...pluggyRow, description: 'Renomeada', originalDescription: 'PIX ENVIADO' },
    ])
    await saveWhatsappEntry('user-1', { ...input, draft: { ...draft, category: null } })
    const data = prismaMock.transaction.update.mock.calls[0][0].data
    expect(data.originalDescription).toBe('PIX ENVIADO')
    expect(data).not.toHaveProperty('category')
  })

  it('par fora da janela não renomeia', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { ...pluggyRow, date: new Date('2026-10-25T00:00:00Z') },
    ])
    const result = await saveWhatsappEntry('user-1', input)
    expect(result.kind).toBe('created')
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  it('mesma mensagem duas vezes', async () => {
    prismaMock.transaction.create.mockRejectedValue({ code: 'P2002' })
    const result = await saveWhatsappEntry('user-1', { ...input, accountId: 'wallet-1' })
    expect(result).toEqual({ kind: 'duplicate' })
    expect(recomputeWalletBalance).not.toHaveBeenCalled()
  })

  it('mesma mensagem duas vezes ao renomear', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([pluggyRow])
    prismaMock.transaction.update.mockRejectedValue({ code: 'P2002' })
    expect(await saveWhatsappEntry('user-1', input)).toEqual({ kind: 'duplicate' })
  })

  it('outro erro sobe', async () => {
    prismaMock.transaction.create.mockRejectedValue(new Error('boom'))
    await expect(saveWhatsappEntry('user-1', input)).rejects.toThrow('boom')
  })
})

describe('undoWhatsappEntry', () => {
  beforeEach(() => {
    resetPrismaMocks(prismaMock)
    recomputeWalletBalance.mockReset()
    runExclusive.mockClear()
  })

  it('sem messageId não faz nada', async () => {
    expect(await undoWhatsappEntry('user-1', undefined)).toEqual({ kind: 'nothing' })
    expect(prismaMock.transaction.findFirst).not.toHaveBeenCalled()
  })

  it('nada achado', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    expect(await undoWhatsappEntry('user-1', 'wamid.1')).toEqual({ kind: 'nothing' })
    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { whatsappMessageId: 'wamid.1', userId: 'user-1' } }),
    )
  })

  it('espera o sync do mesmo usuário', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    await undoWhatsappEntry('user-1', 'wamid.1')
    expect(runExclusive).toHaveBeenCalledWith('user-1', expect.any(Function))
  })

  it('manual é apagado', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: 'tx-m',
      accountId: 'acc-1',
      source: 'MANUAL',
      description: 'Almoço',
      originalDescription: null,
      account: { type: 'BANK' },
    })
    expect(await undoWhatsappEntry('user-1', 'wamid.1')).toEqual({ kind: 'deleted' })
    expect(prismaMock.transaction.delete).toHaveBeenCalledWith({ where: { id: 'tx-m' } })
    expect(recomputeWalletBalance).not.toHaveBeenCalled()
  })

  it('manual na Carteira recalcula o saldo', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: 'tx-m',
      accountId: 'wallet-1',
      source: 'MANUAL',
      description: 'Almoço',
      originalDescription: null,
      account: { type: 'WALLET' },
    })
    expect(await undoWhatsappEntry('user-1', 'wamid.1')).toEqual({ kind: 'deleted' })
    expect(recomputeWalletBalance).toHaveBeenCalledWith('wallet-1')
  })

  it('Pluggy renomeada volta ao texto do banco', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: 'tx-p',
      accountId: 'acc-1',
      source: 'PLUGGY',
      description: 'Almoço',
      originalDescription: 'PIX ENVIADO RESTAURANTE X',
      account: { type: 'BANK' },
    })
    expect(await undoWhatsappEntry('user-1', 'wamid.1')).toEqual({ kind: 'restored' })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-p' },
      data: {
        description: 'PIX ENVIADO RESTAURANTE X',
        descriptionKey: 'restaurante x',
        descriptionLocked: false,
        whatsappMessageId: null,
        originalDescription: null,
      },
    })
    expect(prismaMock.transaction.delete).not.toHaveBeenCalled()
  })

  it('Pluggy sem texto do banco guardado destrava com a descrição atual', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: 'tx-p',
      accountId: 'acc-1',
      source: 'PLUGGY',
      description: 'Almoço',
      originalDescription: null,
      account: { type: 'BANK' },
    })
    expect(await undoWhatsappEntry('user-1', 'wamid.1')).toEqual({ kind: 'restored' })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-p' },
      data: {
        description: 'Almoço',
        descriptionKey: 'almoco',
        descriptionLocked: false,
        whatsappMessageId: null,
        originalDescription: null,
      },
    })
  })
})
