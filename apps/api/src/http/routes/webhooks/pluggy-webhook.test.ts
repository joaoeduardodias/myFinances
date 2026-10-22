import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestApp, makePrismaMock, uuid } from '@/test/helpers'

const prismaMock = makePrismaMock()
const getItem = vi.fn()
const syncConnectionMock = vi.fn()
const removeTransactionsMock = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/pluggy/client', () => ({ pluggy: { getItem } }))
vi.mock('@/services/sync-connection', () => ({
  syncConnection: syncConnectionMock,
}))
vi.mock('@/services/remove-transactions', () => ({
  removeTransactions: removeTransactionsMock,
}))

const { pluggyWebhook, processPluggyEvent, registerPluggyWebhook } =
  await import('./pluggy-webhook')

const SECRET = 's'.repeat(32)
const HEADER = 'x-myfinances-webhook-secret'
const connId = uuid('conn')
const itemId = uuid('item')
const log = { error: vi.fn() }

async function post(body: unknown, headers: Record<string, string> = { [HEADER]: SECRET }) {
  const app = await buildTestApp(pluggyWebhook(SECRET))
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/pluggy',
    headers,
    payload: body as object,
  })
  // O processamento roda em setImmediate, depois da resposta.
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return response
}

beforeEach(() => {
  vi.resetAllMocks()
  syncConnectionMock.mockResolvedValue(undefined)
  prismaMock.connection.findUnique.mockResolvedValue({ id: connId })
})

describe('autenticação e validação', () => {
  it('sem header → 401', async () => {
    const response = await post({ event: 'item/updated', itemId }, {})
    expect(response.statusCode).toBe(401)
    expect(syncConnectionMock).not.toHaveBeenCalled()
  })

  it('header errado de mesmo tamanho → 401', async () => {
    const response = await post(
      { event: 'item/updated', itemId },
      { [HEADER]: 'x'.repeat(32) },
    )
    expect(response.statusCode).toBe(401)
  })

  it('header de tamanho diferente → 401 sem lançar', async () => {
    const response = await post({ event: 'item/updated', itemId }, { [HEADER]: 'curto' })
    expect(response.statusCode).toBe(401)
  })

  it('body sem event → 400', async () => {
    const response = await post({ itemId })
    expect(response.statusCode).toBe(400)
  })
})

describe('processamento', () => {
  it('item/updated com itemId conhecido → 202 e sync', async () => {
    const response = await post({ event: 'item/updated', itemId })
    expect(response.statusCode).toBe(202)
    expect(prismaMock.connection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pluggyItemId: itemId } }),
    )
    expect(syncConnectionMock).toHaveBeenCalledWith(connId)
  })

  it('itemId desconhecido → 202 e nada chamado', async () => {
    prismaMock.connection.findUnique.mockResolvedValue(null)
    const response = await post({ event: 'transactions/created', itemId })
    expect(response.statusCode).toBe(202)
    expect(syncConnectionMock).not.toHaveBeenCalled()
  })

  it('o mesmo evento duas vezes → sync duas vezes', async () => {
    const body = { event: 'transactions/updated', itemId, eventId: 'e1' }
    expect((await post(body)).statusCode).toBe(202)
    expect((await post(body)).statusCode).toBe(202)
    expect(syncConnectionMock).toHaveBeenCalledTimes(2)
  })

  it('transactions/deleted → remove as transações da Pluggy com os ids', async () => {
    await post({ event: 'transactions/deleted', transactionIds: ['t1', 't2'] })
    expect(removeTransactionsMock).toHaveBeenCalledWith({
      source: 'PLUGGY',
      pluggyTransactionId: { in: ['t1', 't2'] },
    })
    expect(syncConnectionMock).not.toHaveBeenCalled()
  })

  it('item/error grava status e lastError do item', async () => {
    getItem.mockResolvedValue({
      id: itemId,
      status: 'LOGIN_ERROR',
      error: { code: '001', message: 'Credenciais inválidas' },
    })
    await post({ event: 'item/error', itemId })
    expect(prismaMock.connection.updateMany).toHaveBeenCalledWith({
      where: { pluggyItemId: itemId },
      data: { status: 'LOGIN_ERROR', lastError: '001: Credenciais inválidas' },
    })
  })

  it('evento desconhecido → 202 e ignorado', async () => {
    const response = await post({ event: 'connector/status_updated' })
    expect(response.statusCode).toBe(202)
    expect(syncConnectionMock).not.toHaveBeenCalled()
  })

  it('syncConnection rejeitando → 202 e erro vai para o log', async () => {
    syncConnectionMock.mockRejectedValue(new Error('boom'))
    const response = await post({ event: 'item/updated', itemId })
    expect(response.statusCode).toBe(202)
  })

  it('processPluggyEvent nunca rejeita e registra o erro', async () => {
    syncConnectionMock.mockRejectedValue(new Error('boom'))
    await expect(
      processPluggyEvent({ event: 'item/created', itemId }, log),
    ).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledTimes(1)
  })
})

describe('registro condicional', () => {
  async function status(secret: string | undefined) {
    const app = await buildTestApp(async (instance) => {
      registerPluggyWebhook(instance, secret)
    })
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/pluggy',
      headers: { [HEADER]: SECRET },
      payload: { event: 'item/updated', itemId },
    })
    return response.statusCode
  }

  it('sem PLUGGY_WEBHOOK_SECRET a rota não existe → 404', async () => {
    expect(await status(undefined)).toBe(404)
  })

  it('com o segredo a rota existe', async () => {
    expect(await status(SECRET)).toBe(202)
  })
})
