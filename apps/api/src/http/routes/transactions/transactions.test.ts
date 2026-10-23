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

const { getTransactions } = await import('./get-transactions')
const { updateTransactionCategory } = await import('./update-transaction-category')
const { updateTransactionTransfer } = await import('./update-transaction-transfer')
const { createManualTransaction } = await import('./create-manual-transaction')
const { deleteManualTransaction } = await import('./delete-manual-transaction')
const { getCategories } = await import('../categories/get-categories')

const userA = uuid('user-a')
const userB = uuid('user-b')
const txId = uuid('tx')
const pairId = uuid('pair')
const walletId = uuid('wallet')

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; body?: unknown; user?: string },
) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: opts.user ?? userA })
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: authHeaders(token),
    ...(opts.body ? { payload: opts.body as object } : {}),
  })
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.$transaction.mockImplementation((cb: (p: unknown) => unknown) => cb(prismaMock))
})

describe('GET /transactions', () => {
  const row = {
    id: txId,
    accountId: uuid('acc'),
    date: new Date('2026-10-05T00:00:00Z'),
    description: 'IFOOD',
    amountCents: -4500,
    category: null,
    categoryLocked: false,
    isTransfer: false,
    source: 'PLUGGY',
    account: { name: 'Nubank', type: 'CHECKING' },
  }

  it('kind=expense exclui transferências e pagina em 50', async () => {
    prismaMock.transaction.count.mockResolvedValue(120)
    prismaMock.transaction.findMany.mockResolvedValue([row])

    const res = await call(getTransactions, {
      method: 'GET',
      url: '/transactions?kind=expense&page=2&from=2026-10-01&to=2026-10-31',
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.page).toBe(2)
    expect(body.totalPages).toBe(3)
    expect(body.transactions[0].date).toBe('2026-10-05')
    expect(body.transactions[0].account).toEqual({ name: 'Nubank', type: 'CHECKING' })
    const args = prismaMock.transaction.findMany.mock.calls[0][0]
    expect(args.where).toMatchObject({
      userId: userA,
      account: { type: { not: 'CREDIT' } },
      amountCents: { lt: 0 },
      isTransfer: false,
    })
    expect(args.skip).toBe(50)
    expect(args.take).toBe(50)
  })

  it('category=none traz as nulas e totalPages mínimo é 1', async () => {
    prismaMock.transaction.count.mockResolvedValue(0)
    prismaMock.transaction.findMany.mockResolvedValue([])
    const res = await call(getTransactions, { method: 'GET', url: '/transactions?category=none' })
    expect(res.json().totalPages).toBe(1)
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where.category).toBeNull()
  })
})

describe('PATCH /transactions/:id/category', () => {
  it('trava, cria a regra e propaga às irmãs não travadas', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, descriptionKey: 'ifood' })

    const res = await call(updateTransactionCategory, {
      method: 'PATCH',
      url: `/transactions/${txId}/category`,
      body: { category: 'Alimentação' },
    })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: txId },
        data: { category: 'Alimentação', categoryLocked: true },
      }),
    )
    expect(prismaMock.categoryRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_descriptionKey: { userId: userA, descriptionKey: 'ifood' } },
      }),
    )
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { userId: userA, descriptionKey: 'ifood', categoryLocked: false },
      data: { category: 'Alimentação' },
    })
  })

  it('chave vazia trava só a transação, sem regra nem propagação', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, descriptionKey: '' })
    const res = await call(updateTransactionCategory, {
      method: 'PATCH',
      url: `/transactions/${txId}/category`,
      body: { category: 'Outros' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalled()
    expect(prismaMock.categoryRule.upsert).not.toHaveBeenCalled()
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('categoria fora da lista dá 400', async () => {
    const res = await call(updateTransactionCategory, {
      method: 'PATCH',
      url: `/transactions/${txId}/category`,
      body: { category: 'Inexistente' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await call(updateTransactionCategory, {
      method: 'PATCH',
      url: `/transactions/${txId}/category`,
      body: { category: 'Outros' },
      user: userB,
    })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.transaction.findFirst.mock.calls[0][0].where).toMatchObject({
      id: txId,
      userId: userB,
    })
  })
})

describe('PATCH /transactions/:id/transfer', () => {
  it('desmarcar destrava e desfaz o par nos dois lados', async () => {
    prismaMock.transaction.findFirst
      .mockResolvedValueOnce({ id: txId, transferPairId: pairId })
      .mockResolvedValueOnce(null)
    prismaMock.transaction.findMany.mockResolvedValue([])

    const res = await call(updateTransactionTransfer, {
      method: 'PATCH',
      url: `/transactions/${txId}/transfer`,
      body: { isTransfer: false },
    })

    expect(res.statusCode).toBe(204)
    const args = prismaMock.transaction.updateMany.mock.calls[0][0]
    expect(args.where.id.in.sort()).toEqual([txId, pairId].sort())
    expect(args.data).toEqual({ isTransfer: false, transferLocked: true, transferPairId: null })
  })

  it('desmarcar um saque apaga o crédito SYSTEM da Carteira e recalcula o saldo', async () => {
    prismaMock.transaction.findFirst
      .mockResolvedValueOnce({ id: txId, transferPairId: pairId })
      .mockResolvedValueOnce({ id: pairId })
    prismaMock.transaction.findMany.mockResolvedValue([{ id: pairId, accountId: walletId }])
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })

    const res = await call(updateTransactionTransfer, {
      method: 'PATCH',
      url: `/transactions/${txId}/transfer`,
      body: { isTransfer: false },
    })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [txId, pairId] },
      userId: userA,
      source: 'SYSTEM',
    })
    expect(prismaMock.transaction.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [pairId] }, userId: userA },
    })
    expect(prismaMock.transaction.updateMany.mock.calls[0][0].where.id.in).toEqual([txId])
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: walletId },
      data: { balanceCents: 0 },
    })
  })

  it('o outro lado do par (que aponta para a transação) também é atualizado', async () => {
    prismaMock.transaction.findFirst
      .mockResolvedValueOnce({ id: txId, transferPairId: null })
      .mockResolvedValueOnce({ id: pairId })

    await call(updateTransactionTransfer, {
      method: 'PATCH',
      url: `/transactions/${txId}/transfer`,
      body: { isTransfer: true },
    })

    const args = prismaMock.transaction.updateMany.mock.calls[0][0]
    expect(args.where.id.in.sort()).toEqual([txId, pairId].sort())
    expect(args.data).toEqual({ isTransfer: true, transferLocked: true })
  })

  it('transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await call(updateTransactionTransfer, {
      method: 'PATCH',
      url: `/transactions/${txId}/transfer`,
      body: { isTransfer: true },
      user: userB,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /transactions', () => {
  it('cria na Carteira como MANUAL e recalcula o saldo', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: walletId })
    prismaMock.transaction.create.mockResolvedValue({
      id: txId,
      accountId: walletId,
      date: new Date('2026-10-10T00:00:00Z'),
      description: 'Padaria 123',
      amountCents: -1500,
      category: 'Alimentação',
      categoryLocked: true,
      isTransfer: false,
      source: 'MANUAL',
      account: { name: 'Carteira', type: 'WALLET' },
    })
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: -1500 } })

    const res = await call(createManualTransaction, {
      method: 'POST',
      url: '/transactions',
      body: { date: '2026-10-10', description: 'Padaria 123', amountCents: -1500, category: 'Alimentação' },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().transaction.date).toBe('2026-10-10')
    const data = prismaMock.transaction.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      userId: userA,
      accountId: walletId,
      source: 'MANUAL',
      status: 'POSTED',
      descriptionKey: 'padaria',
      amountCents: -1500,
      category: 'Alimentação',
    })
    expect(data.date).toEqual(new Date('2026-10-10T00:00:00Z'))
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: walletId },
      data: { balanceCents: -1500 },
    })
  })

  it('valor zero dá 400', async () => {
    const res = await call(createManualTransaction, {
      method: 'POST',
      url: '/transactions',
      body: { date: '2026-10-10', description: 'x', amountCents: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('data que não existe no calendário dá 400', async () => {
    for (const date of ['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29']) {
      const res = await call(createManualTransaction, {
        method: 'POST',
        url: '/transactions',
        body: { date, description: 'x', amountCents: -100 },
      })
      expect(res.statusCode, date).toBe(400)
    }
    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
  })

  it('aceita 29 de fevereiro em ano bissexto', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: walletId })
    prismaMock.transaction.create.mockResolvedValue({
      id: txId,
      accountId: walletId,
      date: new Date('2028-02-29T00:00:00Z'),
      description: 'x',
      amountCents: -100,
      category: null,
      categoryLocked: false,
      isTransfer: false,
      source: 'MANUAL',
      account: { name: 'Carteira', type: 'WALLET' },
    })
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: -100 } })

    const res = await call(createManualTransaction, {
      method: 'POST',
      url: '/transactions',
      body: { date: '2028-02-29', description: 'x', amountCents: -100 },
    })
    expect(res.statusCode).toBe(201)
  })

  it('filtro de período com data impossível dá 400', async () => {
    const res = await call(getTransactions, { method: 'GET', url: '/transactions?from=2026-02-30' })
    expect(res.statusCode).toBe(400)
  })
})

describe('DELETE /transactions/:id', () => {
  it('apagar transação PLUGGY dá 400', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, source: 'PLUGGY', accountId: walletId })
    const res = await call(deleteManualTransaction, { method: 'DELETE', url: `/transactions/${txId}` })
    expect(res.statusCode).toBe(400)
    expect(prismaMock.transaction.delete).not.toHaveBeenCalled()
  })

  it('apagar crédito SYSTEM da Carteira dá 400', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, source: 'SYSTEM', accountId: walletId })
    const res = await call(deleteManualTransaction, { method: 'DELETE', url: `/transactions/${txId}` })
    expect(res.statusCode).toBe(400)
  })

  it('apaga MANUAL e recalcula o saldo', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, source: 'MANUAL', accountId: walletId })
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: null } })
    const res = await call(deleteManualTransaction, { method: 'DELETE', url: `/transactions/${txId}` })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.delete).toHaveBeenCalledWith({ where: { id: txId } })
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: walletId },
      data: { balanceCents: 0 },
    })
  })

  it('transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await call(deleteManualTransaction, {
      method: 'DELETE',
      url: `/transactions/${txId}`,
      user: userB,
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /categories', () => {
  it('lista as categorias', async () => {
    const res = await call(getCategories, { method: 'GET', url: '/categories' })
    expect(res.statusCode).toBe(200)
    expect(res.json().categories).toContain('Mercado')
  })
})
