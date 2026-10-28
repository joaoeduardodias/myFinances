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
const { updateTransactionDescription } = await import('./update-transaction-description')
const { getTransactionSimilar } = await import('./get-transaction-similar')
const { saveTransactionRecurrence } = await import('./save-transaction-recurrence')
const { updateTransactionNecessity } = await import('./update-transaction-necessity')
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
    expect(args.orderBy).toEqual([{ date: 'desc' }, { date: 'desc' }, { id: 'asc' }])
  })

  it('ordena pela coluna pedida, com a categoria vazia por último', async () => {
    prismaMock.transaction.count.mockResolvedValue(0)
    prismaMock.transaction.findMany.mockResolvedValue([])
    await call(getTransactions, { method: 'GET', url: '/transactions?sort=category&order=asc' })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].orderBy[0]).toEqual({
      category: { sort: 'asc', nulls: 'last' },
    })
    await call(getTransactions, { method: 'GET', url: '/transactions?sort=account&order=desc' })
    expect(prismaMock.transaction.findMany.mock.calls[1][0].orderBy[0]).toEqual({ account: { name: 'desc' } })
  })

  it('coluna de ordenação desconhecida dá 400', async () => {
    const res = await call(getTransactions, { method: 'GET', url: '/transactions?sort=id' })
    expect(res.statusCode).toBe(400)
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
      body: { category: 'Restaurante' },
    })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: txId },
        data: { category: 'Restaurante', categoryLocked: true },
      }),
    )
    expect(prismaMock.categoryRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_descriptionKey: { userId: userA, descriptionKey: 'ifood' } },
      }),
    )
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { userId: userA, descriptionKey: 'ifood', categoryLocked: false },
      data: { category: 'Restaurante' },
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

describe('PATCH /transactions/:id/necessity', () => {
  const url = `/transactions/${txId}/necessity`

  it('grava a marca num débito do usuário', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, amountCents: -4500, isTransfer: false })
    const res = await call(updateTransactionNecessity, {
      method: 'PATCH',
      url,
      body: { necessity: 'AVOIDABLE' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: txId, userId: userA } }),
    )
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { necessity: 'AVOIDABLE' },
    })
  })

  it('PATCH necessity aceita EMERGENCY', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, amountCents: -4500, isTransfer: false })
    const res = await call(updateTransactionNecessity, {
      method: 'PATCH',
      url,
      body: { necessity: 'EMERGENCY' },
    })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { necessity: 'EMERGENCY' },
    })
  })

  it('null tira a marca', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txId, amountCents: -4500, isTransfer: false })
    const res = await call(updateTransactionNecessity, { method: 'PATCH', url, body: { necessity: null } })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { necessity: null },
    })
  })

  it('transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await call(updateTransactionNecessity, {
      method: 'PATCH',
      url,
      body: { necessity: 'ESSENTIAL' },
      user: userB,
    })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  it('crédito ou transferência dá 400', async () => {
    prismaMock.transaction.findFirst.mockResolvedValueOnce({ id: txId, amountCents: 5000, isTransfer: false })
    const credit = await call(updateTransactionNecessity, {
      method: 'PATCH',
      url,
      body: { necessity: 'ESSENTIAL' },
    })
    expect(credit.statusCode).toBe(400)

    prismaMock.transaction.findFirst.mockResolvedValueOnce({ id: txId, amountCents: -5000, isTransfer: true })
    const transfer = await call(updateTransactionNecessity, {
      method: 'PATCH',
      url,
      body: { necessity: 'ESSENTIAL' },
    })
    expect(transfer.statusCode).toBe(400)
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })
})

describe('PATCH /transactions/:id/description', () => {
  const url = `/transactions/${txId}/description`
  const patch = (description: string, user?: string) =>
    call(updateTransactionDescription, { method: 'PATCH', url, body: { description }, user })

  it('PATCH description de transação da Pluggy trava e guarda o texto do banco', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'PIX JOAO',
      originalDescription: null,
    })
    const res = await patch('Almoço com Ana')
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: txId, userId: userA } }),
    )
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { description: 'Almoço com Ana', descriptionLocked: true, originalDescription: 'PIX JOAO' },
    })
    expect(prismaMock.transaction.update.mock.calls[0][0].data).not.toHaveProperty('descriptionKey')
  })

  it('segunda edição mantém o texto do banco', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'Almoço com Ana',
      originalDescription: 'PIX JOAO',
    })
    const res = await patch('Almoço')
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { description: 'Almoço', descriptionLocked: true, originalDescription: 'PIX JOAO' },
    })
  })

  it('lançamento manual só troca a descrição', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'MANUAL',
      description: 'Posto',
      originalDescription: null,
    })
    const res = await patch('Gasolina')
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { description: 'Gasolina' },
    })
  })

  it('descrição vazia volta o texto do banco', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'Almoço',
      originalDescription: 'PIX JOAO',
    })
    const res = await patch('   ')
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { description: 'PIX JOAO', descriptionLocked: false, originalDescription: null },
    })
  })

  it('descrição vazia em lançamento manual dá 400', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'MANUAL',
      description: 'Gasolina',
      originalDescription: null,
    })
    const res = await patch('')
    expect(res.statusCode).toBe(400)
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  it('descrição de transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await patch('Almoço', userB)
    expect(res.statusCode).toBe(404)
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  const applyAll = (description: string) =>
    call(updateTransactionDescription, { method: 'PATCH', url, body: { description, applyToSimilar: true } })

  it('applyToSimilar renomeia as parecidas da Pluggy e grava o nome para as próximas', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'FINANC VEICULO 3/48',
      originalDescription: null,
      descriptionKey: 'financ veiculo',
    })
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: txId, description: 'FINANC VEICULO 3/48', originalDescription: null },
      { id: pairId, description: 'Carro', originalDescription: 'FINANC VEICULO 2/48' },
    ])

    const res = await applyAll('Parcela do carro')

    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: userA,
      descriptionKey: 'financ veiculo',
      source: 'PLUGGY',
    })
    expect(prismaMock.transaction.update.mock.calls.map((c) => c[0])).toEqual([
      {
        where: { id: txId },
        data: { description: 'Parcela do carro', descriptionLocked: true, originalDescription: 'FINANC VEICULO 3/48' },
      },
      {
        where: { id: pairId },
        data: { description: 'Parcela do carro', descriptionLocked: true, originalDescription: 'FINANC VEICULO 2/48' },
      },
    ])
    expect(prismaMock.descriptionRule.upsert).toHaveBeenCalledWith({
      where: { userId_descriptionKey: { userId: userA, descriptionKey: 'financ veiculo' } },
      create: { userId: userA, descriptionKey: 'financ veiculo', description: 'Parcela do carro' },
      update: { description: 'Parcela do carro' },
    })
  })

  it('sem applyToSimilar não grava regra', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'FINANC VEICULO 3/48',
      originalDescription: null,
      descriptionKey: 'financ veiculo',
    })
    await patch('Parcela do carro')
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled()
    expect(prismaMock.descriptionRule.upsert).not.toHaveBeenCalled()
  })

  it('vazia com applyToSimilar volta o texto do banco em todas e apaga a regra', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'Parcela do carro',
      originalDescription: 'FINANC VEICULO 3/48',
      descriptionKey: 'financ veiculo',
    })
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: txId, description: 'Parcela do carro', originalDescription: 'FINANC VEICULO 3/48' },
      { id: pairId, description: 'FINANC VEICULO 1/48', originalDescription: null },
    ])

    const res = await applyAll('')

    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: txId },
      data: { description: 'FINANC VEICULO 3/48', descriptionLocked: false, originalDescription: null },
    })
    expect(prismaMock.descriptionRule.deleteMany).toHaveBeenCalledWith({
      where: { userId: userA, descriptionKey: 'financ veiculo' },
    })
  })

  it('vazia só nesta também apaga a regra das próximas', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      source: 'PLUGGY',
      description: 'Parcela do carro',
      originalDescription: 'FINANC VEICULO 3/48',
      descriptionKey: 'financ veiculo',
    })
    await patch('')
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled()
    expect(prismaMock.descriptionRule.deleteMany).toHaveBeenCalledWith({
      where: { userId: userA, descriptionKey: 'financ veiculo' },
    })
  })
})

const recurrenceTx = {
  accountId: uuid('acc'),
  date: new Date('2026-10-15T00:00:00Z'),
  amountCents: -150000,
  description: 'Parcela do carro',
  descriptionKey: 'financ veiculo',
  isTransfer: false,
  source: 'PLUGGY',
  whatsappMessageId: null,
}

describe('GET /transactions/:id/similar', () => {
  const get = (user?: string) =>
    call(getTransactionSimilar, { method: 'GET', url: `/transactions/${txId}/similar`, user })

  it('conta as outras da Pluggy com o mesmo texto e acha o recorrente do dia', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(recurrenceTx)
    prismaMock.transaction.count.mockResolvedValue(23)
    prismaMock.recurrence.findMany.mockResolvedValue([
      { id: uuid('r1'), status: 'SUGGESTED', dayRule: 'DAY_OF_MONTH', dayValue: 14 },
    ])

    const res = await get()

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ similar: 23, canSaveRecurrence: true, recurrenceStatus: 'SUGGESTED' })
    expect(prismaMock.transaction.count.mock.calls[0][0].where).toEqual({
      userId: userA,
      descriptionKey: 'financ veiculo',
      source: 'PLUGGY',
      id: { not: txId },
    })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: userA,
      accountId: recurrenceTx.accountId,
      descriptionKey: 'financ veiculo',
      direction: 'OUT',
    })
  })

  it('transferência não pode virar recorrente', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ ...recurrenceTx, isTransfer: true })
    prismaMock.transaction.count.mockResolvedValue(0)
    const res = await get()
    expect(res.json()).toEqual({ similar: 0, canSaveRecurrence: false, recurrenceStatus: null })
    expect(prismaMock.recurrence.findMany).not.toHaveBeenCalled()
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const res = await get(userB)
    expect(res.statusCode).toBe(404)
    expect(prismaMock.transaction.findFirst.mock.calls[0][0].where).toEqual({ id: txId, userId: userB })
  })
})

describe('POST /transactions/:id/recurrence', () => {
  const post = () => call(saveTransactionRecurrence, { method: 'POST', url: `/transactions/${txId}/recurrence` })

  it('cria o recorrente confirmado com o nome, a conta, o valor e o dia da transação', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(recurrenceTx)
    prismaMock.recurrence.findMany.mockResolvedValue([
      // Outro dia do mês: é outra ocorrência, não esta.
      { id: uuid('r1'), status: 'CONFIRMED', dayRule: 'DAY_OF_MONTH', dayValue: 1 },
    ])

    const res = await post()

    expect(res.statusCode).toBe(204)
    expect(prismaMock.recurrence.create).toHaveBeenCalledWith({
      data: {
        userId: userA,
        accountId: recurrenceTx.accountId,
        description: 'Parcela do carro',
        descriptionKey: 'financ veiculo',
        direction: 'OUT',
        expectedAmountCents: 150000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 15,
        status: 'CONFIRMED',
      },
    })
  })

  it('confirma e renomeia o recorrente que já existe, mesmo descartado', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(recurrenceTx)
    prismaMock.recurrence.findMany.mockResolvedValue([
      { id: uuid('r1'), status: 'DISMISSED', dayRule: 'DAY_OF_MONTH', dayValue: 17 },
    ])

    const res = await post()

    expect(res.statusCode).toBe(204)
    expect(prismaMock.recurrence.update).toHaveBeenCalledWith({
      where: { id: uuid('r1') },
      data: { status: 'CONFIRMED', description: 'Parcela do carro' },
    })
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })

  it('lançamento do WhatsApp dá 400', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      ...recurrenceTx,
      source: 'MANUAL',
      whatsappMessageId: 'wamid.1',
    })
    const res = await post()
    expect(res.statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
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
      category: 'Restaurante',
      categoryLocked: true,
      isTransfer: false,
      source: 'MANUAL',
      account: { name: 'Carteira', type: 'WALLET' },
    })
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: -1500 } })

    const res = await call(createManualTransaction, {
      method: 'POST',
      url: '/transactions',
      body: { date: '2026-10-10', description: 'Padaria 123', amountCents: -1500, category: 'Restaurante' },
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
      category: 'Restaurante',
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
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: txId,
      source: 'MANUAL',
      accountId: walletId,
      account: { type: 'WALLET' },
    })
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: null } })
    const res = await call(deleteManualTransaction, { method: 'DELETE', url: `/transactions/${txId}` })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.delete).toHaveBeenCalledWith({ where: { id: txId } })
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: walletId },
      data: { balanceCents: 0 },
    })
  })

  it('apagar manual em conta de banco não recalcula saldo', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: txId,
      source: 'MANUAL',
      accountId: uuid('bank'),
      account: { type: 'BANK' },
    })
    const res = await call(deleteManualTransaction, { method: 'DELETE', url: `/transactions/${txId}` })
    expect(res.statusCode).toBe(204)
    expect(prismaMock.transaction.delete).toHaveBeenCalledWith({ where: { id: txId } })
    expect(prismaMock.transaction.aggregate).not.toHaveBeenCalled()
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
