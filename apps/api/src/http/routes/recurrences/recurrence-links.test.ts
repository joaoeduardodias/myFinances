import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authHeaders, buildTestApp, makePrismaMock, signToken, uuid } from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const linkSimilarMock = vi.fn()
vi.mock('@/services/link-similar-transactions', () => ({ linkSimilarTransactions: linkSimilarMock }))

const { getLinkCandidates } = await import('./get-link-candidates')
const { linkTransactions } = await import('./link-transactions')
const { unlinkTransaction } = await import('./unlink-transaction')
const { dismissLinkSuggestion } = await import('./dismiss-link-suggestion')

const userA = uuid('user-a')
const recurrenceId = uuid('rec')
const txA = uuid('tx-a')
const txB = uuid('tx-b')

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'POST' | 'DELETE'; url: string; body?: unknown },
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
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'))
  prismaMock.recurrence.findFirst.mockResolvedValue({ id: recurrenceId, direction: 'OUT', kind: 'MONTHLY' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('autenticação', () => {
  it('exige token em todas as rotas de vínculo', async () => {
    const cases = [
      [getLinkCandidates, 'GET', `/recurrences/${recurrenceId}/link-candidates`, undefined],
      [linkTransactions, 'POST', `/recurrences/${recurrenceId}/links`, { transactionIds: [txA] }],
      [unlinkTransaction, 'DELETE', `/recurrences/${recurrenceId}/links/${txA}`, undefined],
      [dismissLinkSuggestion, 'POST', `/recurrences/${recurrenceId}/link-dismissals`, { transactionId: txA }],
    ] as const
    for (const [plugin, method, url, payload] of cases) {
      const app = await buildTestApp(plugin)
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) })
      expect(response.statusCode).toBe(401)
    }
  })
})

describe('GET /recurrences/:id/link-candidates', () => {
  const row = {
    id: txA,
    date: new Date('2026-10-10T00:00:00Z'),
    description: 'PIX ENERGISA',
    amountCents: -21200,
    account: { name: 'Caixa' },
    recurrence: { id: uuid('other'), description: 'Luz antiga' },
  }

  it('lista as do mesmo sinal, sem transferência, do último ano, buscando no texto, 10 por página', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([row])
    prismaMock.transaction.count.mockResolvedValue(11)

    const response = await call(getLinkCandidates, {
      method: 'GET',
      url: `/recurrences/${recurrenceId}/link-candidates?search=energisa&page=2`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      total: 11,
      page: 2,
      pageSize: 10,
      items: [
        {
          id: txA,
          date: '2026-10-10',
          description: 'PIX ENERGISA',
          amountCents: -21200,
          account: { name: 'Caixa' },
          linkedTo: { id: uuid('other'), description: 'Luz antiga' },
          linkedHere: false,
        },
      ],
    })
    const args = prismaMock.transaction.findMany.mock.calls[0][0]
    expect(args.where).toEqual({
      userId: userA,
      isTransfer: false,
      amountCents: { lt: 0 },
      date: { gte: new Date('2025-10-20T00:00:00Z') },
      description: { contains: 'energisa', mode: 'insensitive' },
    })
    expect(args.orderBy).toEqual([{ date: 'desc' }, { id: 'asc' }])
    expect(args.skip).toBe(10)
    expect(args.take).toBe(10)
    expect(prismaMock.transaction.count.mock.calls[0][0].where).toEqual(args.where)
  })

  it('só as vinculadas deste recorrente, para o "ver todas"', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([])
    prismaMock.transaction.count.mockResolvedValue(0)

    await call(getLinkCandidates, { method: 'GET', url: `/recurrences/${recurrenceId}/link-candidates?linked=true` })

    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({ userId: userA, recurrenceId })
  })

  it('empréstimo em folha lista entradas e marca os salários já vinculados a ele', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({
      id: recurrenceId,
      direction: 'OUT',
      kind: 'LOAN',
      payrollDeduction: true,
    })
    prismaMock.transaction.findMany.mockResolvedValue([
      { ...row, amountCents: 300000, recurrence: { id: uuid('salary'), description: 'Salário' }, payrollLinks: [{ recurrenceId }] },
    ])
    prismaMock.transaction.count.mockResolvedValue(1)

    const response = await call(getLinkCandidates, { method: 'GET', url: `/recurrences/${recurrenceId}/link-candidates` })

    expect(prismaMock.transaction.findMany.mock.calls[0][0].where.amountCents).toEqual({ gt: 0 })
    // O salário continua sendo do recorrente dele: não há "de: outro" a mudar.
    expect(response.json().items[0]).toMatchObject({ linkedHere: true, linkedTo: null })

    await call(getLinkCandidates, {
      method: 'GET',
      url: `/recurrences/${recurrenceId}/link-candidates?linked=true`,
    })
    expect(prismaMock.transaction.findMany.mock.calls[1][0].where).toEqual({
      userId: userA,
      payrollLinks: { some: { recurrenceId } },
    })
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(getLinkCandidates, { method: 'GET', url: `/recurrences/${recurrenceId}/link-candidates` })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrence.findFirst.mock.calls[0][0].where).toEqual({ id: recurrenceId, userId: userA })
  })
})

describe('POST /recurrences/:id/links', () => {
  const post = (transactionIds: string[]) =>
    call(linkTransactions, { method: 'POST', url: `/recurrences/${recurrenceId}/links`, body: { transactionIds } })

  it('vincula, mudando de recorrente a que já tinha outro', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: txA, amountCents: -100, isTransfer: false },
      { id: txB, amountCents: -200, isTransfer: false },
    ])

    linkSimilarMock.mockResolvedValue(3)
    const response = await post([txA, txB])

    expect(response.statusCode).toBe(200)
    // As escolhidas e as parecidas que vieram junto, para a tela contar.
    expect(response.json()).toEqual({ linked: 2, similar: 3 })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where).toEqual({ id: { in: [txA, txB] }, userId: userA })
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [txA, txB] }, userId: userA },
      data: { recurrenceId },
    })
    // Vinculou uma parcela: as outras do mesmo padrão vêm junto.
    expect(linkSimilarMock).toHaveBeenCalledWith(userA, { recurrenceIds: [recurrenceId] })
  })

  it('transação de outro usuário dá 404 e nada é vinculado', async () => {
    prismaMock.transaction.findMany.mockResolvedValue([{ id: txA, amountCents: -100, isTransfer: false }])
    const response = await post([txA, txB])
    expect(response.statusCode).toBe(404)
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('sinal trocado ou transferência dão 400', async () => {
    for (const tx of [
      { id: txA, amountCents: 100, isTransfer: false },
      { id: txA, amountCents: -100, isTransfer: true },
    ]) {
      prismaMock.transaction.findMany.mockResolvedValue([tx])
      const response = await post([txA])
      expect(response.statusCode).toBe(400)
    }
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('fora da Pluggy não recebe transação', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ id: recurrenceId, direction: 'IN', kind: 'EXTERNAL' })
    const response = await post([txA])
    expect(response.statusCode).toBe(400)
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('lista vazia, repetida ou com mais de 100 dá 400', async () => {
    for (const ids of [[], [txA, txA], Array.from({ length: 101 }, (_, i) => uuid(`t${i}`))]) {
      const response = await post(ids)
      expect(response.statusCode).toBe(400)
    }
  })

  it('empréstimo em folha vincula o crédito do salário sem tirá-lo do recorrente dele', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({
      id: recurrenceId,
      direction: 'OUT',
      kind: 'LOAN',
      payrollDeduction: true,
    })
    prismaMock.transaction.findMany.mockResolvedValue([{ id: txA, amountCents: 300000, isTransfer: false }])

    const response = await post([txA])

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ linked: 1, similar: 0 })
    expect(prismaMock.recurrencePayrollLink.createMany).toHaveBeenCalledWith({
      data: [{ recurrenceId, transactionId: txA }],
      skipDuplicates: true,
    })
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()

    prismaMock.transaction.findMany.mockResolvedValue([{ id: txA, amountCents: -300, isTransfer: false }])
    expect((await post([txA])).statusCode).toBe(400)
  })

  it('recorrente de outro usuário dá 404', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await post([txA])
    expect(response.statusCode).toBe(404)
  })
})

describe('DELETE /recurrences/:id/links/:transactionId', () => {
  it('desvincula a transação deste recorrente', async () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 1 })
    const response = await call(unlinkTransaction, { method: 'DELETE', url: `/recurrences/${recurrenceId}/links/${txA}` })
    expect(response.statusCode).toBe(204)
    expect(prismaMock.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: txA, userId: userA, recurrenceId },
      data: { recurrenceId: null },
    })
    // Desvinculada à mão não volta no vínculo automático das irmãs.
    expect(prismaMock.recurrenceLinkDismissal.createMany).toHaveBeenCalledWith({
      data: [{ recurrenceId, transactionId: txA }],
      skipDuplicates: true,
    })
  })

  it('em folha desfaz só o vínculo com o salário', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({
      id: recurrenceId,
      direction: 'OUT',
      kind: 'LOAN',
      payrollDeduction: true,
    })
    prismaMock.recurrencePayrollLink.deleteMany.mockResolvedValue({ count: 1 })
    const response = await call(unlinkTransaction, { method: 'DELETE', url: `/recurrences/${recurrenceId}/links/${txA}` })
    expect(response.statusCode).toBe(204)
    expect(prismaMock.recurrencePayrollLink.deleteMany).toHaveBeenCalledWith({
      where: { recurrenceId, transactionId: txA },
    })
    // Desvinculado à mão não volta no vínculo automático.
    expect(prismaMock.recurrenceLinkDismissal.createMany).toHaveBeenCalledWith({
      data: [{ recurrenceId, transactionId: txA }],
      skipDuplicates: true,
    })
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()

    prismaMock.recurrencePayrollLink.deleteMany.mockResolvedValue({ count: 0 })
    const missing = await call(unlinkTransaction, { method: 'DELETE', url: `/recurrences/${recurrenceId}/links/${txA}` })
    expect(missing.statusCode).toBe(404)
  })

  it('recorrente de outro usuário dá 404 ao desvincular', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(unlinkTransaction, { method: 'DELETE', url: `/recurrences/${recurrenceId}/links/${txA}` })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('transação que não é deste recorrente dá 404', async () => {
    prismaMock.transaction.updateMany.mockResolvedValue({ count: 0 })
    const response = await call(unlinkTransaction, { method: 'DELETE', url: `/recurrences/${recurrenceId}/links/${txA}` })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /recurrences/:id/link-dismissals', () => {
  const post = () =>
    call(dismissLinkSuggestion, {
      method: 'POST',
      url: `/recurrences/${recurrenceId}/link-dismissals`,
      body: { transactionId: txA },
    })

  it('guarda o "Não é" sem duplicar', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue({ id: txA })
    const response = await post()
    expect(response.statusCode).toBe(204)
    expect(prismaMock.transaction.findFirst.mock.calls[0][0].where).toEqual({ id: txA, userId: userA })
    expect(prismaMock.recurrenceLinkDismissal.createMany).toHaveBeenCalledWith({
      data: [{ recurrenceId, transactionId: txA }],
      skipDuplicates: true,
    })
  })

  it('transação de outro usuário dá 404', async () => {
    prismaMock.transaction.findFirst.mockResolvedValue(null)
    const response = await post()
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrenceLinkDismissal.createMany).not.toHaveBeenCalled()
  })
})
