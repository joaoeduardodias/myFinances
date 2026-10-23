import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()
const getItem = vi.fn()
const syncConnectionMock = vi.fn()
const ensureWalletAccountMock = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/pluggy/client', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/pluggy/client')>()),
  pluggy: { getItem },
}))
vi.mock('@/services/sync-connection', () => ({
  syncConnection: syncConnectionMock,
}))
vi.mock('@/services/wallet', () => ({
  ensureWalletAccount: ensureWalletAccountMock,
}))
const removeTransactionsMock = vi.fn()
vi.mock('@/services/remove-transactions', () => ({
  removeTransactions: removeTransactionsMock,
}))

const { PluggyError, PluggyNotFoundError } = await import('@/lib/pluggy/client')
const { createConnection } = await import('./create-connection')
const { getConnections } = await import('./get-connections')
const { deleteConnection } = await import('./delete-connection')
const { syncConnectionRoute } = await import('./sync-connection')
const { syncAll } = await import('./sync-all')
const { getAccounts } = await import('../accounts/get-accounts')

const userA = uuid('user-a')
const userB = uuid('user-b')
const connId = uuid('conn')
const itemId = uuid('item')

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'POST' | 'DELETE'; url: string; user?: string; body?: unknown },
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
  vi.clearAllMocks()
  syncConnectionMock.mockResolvedValue(undefined)
})

describe('autenticação', () => {
  it('exige token em todas as rotas', async () => {
    const cases = [
      [createConnection, 'POST', '/connections'],
      [getConnections, 'GET', '/connections'],
      [deleteConnection, 'DELETE', `/connections/${connId}`],
      [syncConnectionRoute, 'POST', `/connections/${connId}/sync`],
      [syncAll, 'POST', '/sync'],
      [getAccounts, 'GET', '/accounts'],
    ] as const
    for (const [plugin, method, url] of cases) {
      const app = await buildTestApp(plugin)
      const response = await app.inject({
        method,
        url,
        ...(method === 'POST' && url === '/connections' ? { payload: { itemId } } : {}),
      })
      expect(response.statusCode).toBe(401)
    }
  })
})

describe('POST /connections', () => {
  const row = {
    id: connId,
    connectorName: 'Nubank',
    status: 'UPDATED',
    consentExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
  }

  it('cria a conexão, sincroniza e responde 201', async () => {
    getItem.mockResolvedValue({ id: itemId, connector: { name: 'Nubank' }, status: 'UPDATED' })
    prismaMock.connection.findUnique.mockResolvedValue(null)
    prismaMock.connection.create.mockResolvedValue(row)
    prismaMock.connection.findUniqueOrThrow.mockResolvedValue(row)

    const response = await call(createConnection, {
      method: 'POST',
      url: '/connections',
      body: { itemId },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({ connection: row })
    expect(prismaMock.connection.create.mock.calls[0][0].data).toMatchObject({
      userId: userA,
      pluggyItemId: itemId,
      connectorName: 'Nubank',
    })
    expect(syncConnectionMock).toHaveBeenCalledWith(connId)
  })

  it('responde 400 quando a Pluggy não conhece o item', async () => {
    getItem.mockRejectedValue(new PluggyNotFoundError('/items/x'))
    const response = await call(createConnection, {
      method: 'POST',
      url: '/connections',
      body: { itemId },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe('Item não encontrado na Pluggy')
    expect(prismaMock.connection.create).not.toHaveBeenCalled()
  })

  it('responde 409 quando o item já está cadastrado, de qualquer usuário', async () => {
    getItem.mockResolvedValue({ id: itemId, connector: { name: 'Nubank' }, status: 'UPDATED' })
    prismaMock.connection.findUnique.mockResolvedValue({ id: 'x', userId: userB })
    const response = await call(createConnection, {
      method: 'POST',
      url: '/connections',
      body: { itemId },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe('Esta conexão já está cadastrada')
    expect(prismaMock.connection.create).not.toHaveBeenCalled()
  })

  it('responde 201 mesmo se a sincronização falhar', async () => {
    getItem.mockResolvedValue({ id: itemId, connector: { name: 'Nubank' }, status: 'UPDATED' })
    prismaMock.connection.findUnique.mockResolvedValue(null)
    prismaMock.connection.create.mockResolvedValue(row)
    prismaMock.connection.findUniqueOrThrow.mockResolvedValue({ ...row, lastError: 'Pluggy 500 em /x: falhou' })
    syncConnectionMock.mockRejectedValue(new Error('falhou'))

    const response = await call(createConnection, {
      method: 'POST',
      url: '/connections',
      body: { itemId },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().connection.lastError).toBe(
      'Falha ao falar com a Pluggy. Tente de novo mais tarde.',
    )
  })

  it('rejeita itemId que não é uuid', async () => {
    const response = await call(createConnection, {
      method: 'POST',
      url: '/connections',
      body: { itemId: 'abc' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('GET /connections', () => {
  it('traduz o lastError cru da Pluggy para português', async () => {
    const base = {
      connectorName: 'Nubank',
      status: 'LOGIN_ERROR',
      consentExpiresAt: null,
      lastSyncedAt: null,
    }
    prismaMock.connection.findMany.mockResolvedValue([
      { ...base, id: uuid('c1'), lastError: 'USER_AUTHORIZATION_EXPIRED: Consent expired' },
      { ...base, id: uuid('c2'), lastError: 'LOGIN_ERROR: Invalid credentials' },
      { ...base, id: uuid('c3'), lastError: 'Pluggy 403 em /items/x: Forbidden' },
      { ...base, id: uuid('c4'), lastError: 'Pluggy 500 em /accounts: Internal error' },
      { ...base, id: uuid('c5'), lastError: null },
    ])

    const response = await call(getConnections, { method: 'GET', url: '/connections' })

    expect(response.json().connections.map((c: { lastError: string | null }) => c.lastError)).toEqual([
      'A Pluggy recusou o acesso — reautorize no Meu Pluggy.',
      'A Pluggy recusou o acesso — reautorize no Meu Pluggy.',
      'A Pluggy recusou o acesso — reautorize no Meu Pluggy.',
      'Falha ao falar com a Pluggy. Tente de novo mais tarde.',
      null,
    ])
  })

  it('lista só as conexões do usuário', async () => {
    const row = {
      id: connId,
      connectorName: 'Nubank',
      status: 'UPDATED',
      consentExpiresAt: null,
      lastSyncedAt: null,
      lastError: null,
    }
    prismaMock.connection.findMany.mockResolvedValue([row])
    const response = await call(getConnections, { method: 'GET', url: '/connections' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ connections: [row] })
    expect(prismaMock.connection.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
  })
})

describe('DELETE /connections/:id', () => {
  it('apaga a conexão do usuário e responde 204', async () => {
    prismaMock.connection.findFirst.mockResolvedValue({ id: connId })
    const response = await call(deleteConnection, {
      method: 'DELETE',
      url: `/connections/${connId}`,
    })
    expect(response.statusCode).toBe(204)
    expect(prismaMock.connection.findFirst.mock.calls[0][0].where).toEqual({
      id: connId,
      userId: userA,
    })
    expect(prismaMock.connection.delete).toHaveBeenCalledWith({ where: { id: connId } })
  })

  it('apaga as transações antes, para o crédito do saque na Carteira não ficar órfão', async () => {
    prismaMock.connection.findFirst.mockResolvedValue({ id: connId })
    await call(deleteConnection, { method: 'DELETE', url: `/connections/${connId}` })
    expect(removeTransactionsMock).toHaveBeenCalledWith({
      userId: userA,
      account: { connectionId: connId },
    })
    expect(removeTransactionsMock.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.connection.delete.mock.invocationCallOrder[0],
    )
  })

  it('responde 404 para conexão de outro usuário', async () => {
    prismaMock.connection.findFirst.mockResolvedValue(null)
    const response = await call(deleteConnection, {
      method: 'DELETE',
      url: `/connections/${connId}`,
      user: userB,
    })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.connection.findFirst.mock.calls[0][0].where).toEqual({
      id: connId,
      userId: userB,
    })
    expect(prismaMock.connection.delete).not.toHaveBeenCalled()
  })
})

describe('POST /connections/:id/sync', () => {
  it('sincroniza e responde 204', async () => {
    prismaMock.connection.findFirst.mockResolvedValue({ id: connId })
    const response = await call(syncConnectionRoute, {
      method: 'POST',
      url: `/connections/${connId}/sync`,
    })
    expect(response.statusCode).toBe(204)
    expect(syncConnectionMock).toHaveBeenCalledWith(connId)
  })

  it('falha da Pluggy vira 502 com a mensagem em português', async () => {
    prismaMock.connection.findFirst.mockResolvedValue({ id: connId })
    syncConnectionMock.mockRejectedValue(new PluggyError('Pluggy 500 em /accounts: boom', 500))

    const response = await call(syncConnectionRoute, {
      method: 'POST',
      url: `/connections/${connId}/sync`,
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().message).toBe('Falha ao falar com a Pluggy. Tente de novo mais tarde.')
  })

  it('autorização vencida vira 502 pedindo para reautorizar', async () => {
    prismaMock.connection.findFirst.mockResolvedValue({ id: connId })
    syncConnectionMock.mockRejectedValue(new PluggyError('Pluggy 401 em /items/x: Unauthorized', 401))

    const response = await call(syncConnectionRoute, {
      method: 'POST',
      url: `/connections/${connId}/sync`,
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().message).toBe('A Pluggy recusou o acesso — reautorize no Meu Pluggy.')
  })

  it('responde 404 para conexão de outro usuário, sem sincronizar', async () => {
    prismaMock.connection.findFirst.mockResolvedValue(null)
    const response = await call(syncConnectionRoute, {
      method: 'POST',
      url: `/connections/${connId}/sync`,
      user: userB,
    })
    expect(response.statusCode).toBe(404)
    expect(syncConnectionMock).not.toHaveBeenCalled()
  })
})

describe('POST /sync', () => {
  it('sincroniza só as conexões nunca sincronizadas ou velhas (> 6 h)', async () => {
    prismaMock.connection.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    const before = Date.now()
    const response = await call(syncAll, { method: 'POST', url: '/sync' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 2 })
    const where = prismaMock.connection.findMany.mock.calls[0][0].where
    expect(where.userId).toBe(userA)
    expect(where.OR[0]).toEqual({ lastSyncedAt: null })
    const limit = where.OR[1].lastSyncedAt.lt as Date
    const sixHours = 6 * 60 * 60 * 1000
    expect(limit.getTime() + sixHours).toBeGreaterThanOrEqual(before)
    expect(limit.getTime() + sixHours).toBeLessThan(before + 5000)
  })

  it('com force=true sincroniza todas', async () => {
    prismaMock.connection.findMany.mockResolvedValue([{ id: 'c1' }])
    await call(syncAll, { method: 'POST', url: '/sync?force=true' })
    expect(prismaMock.connection.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
  })

  it('uma falha não impede as outras e não conta como sincronizada', async () => {
    prismaMock.connection.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }])
    const order: string[] = []
    syncConnectionMock.mockImplementation(async (id: string) => {
      order.push(id)
      if (id === 'c2') throw new Error('Pluggy fora')
    })

    const response = await call(syncAll, { method: 'POST', url: '/sync' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ synced: 2 })
    expect(order).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('GET /accounts', () => {
  it('garante a Carteira e lista as contas do usuário', async () => {
    ensureWalletAccountMock.mockResolvedValue({})
    prismaMock.account.findMany.mockResolvedValue([
      {
        id: uuid('w'),
        type: 'WALLET',
        name: 'Carteira',
        number: null,
        balanceCents: 1000,
        closingDay: null,
        dueDay: null,
        connection: null,
      },
      {
        id: uuid('c'),
        type: 'CREDIT',
        name: 'Cartão',
        number: '1234',
        balanceCents: 5000,
        closingDay: 3,
        dueDay: 10,
        connection: { connectorName: 'Nubank' },
      },
    ])

    const response = await call(getAccounts, { method: 'GET', url: '/accounts' })

    expect(response.statusCode).toBe(200)
    expect(ensureWalletAccountMock).toHaveBeenCalledWith(userA)
    expect(prismaMock.account.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
    expect(response.json().accounts).toEqual([
      {
        id: uuid('w'),
        type: 'WALLET',
        name: 'Carteira',
        number: null,
        balanceCents: 1000,
        closingDay: null,
        dueDay: null,
        connectorName: null,
      },
      {
        id: uuid('c'),
        type: 'CREDIT',
        name: 'Cartão',
        number: '1234',
        balanceCents: 5000,
        closingDay: 3,
        dueDay: 10,
        connectorName: 'Nubank',
      },
    ])
  })
})
