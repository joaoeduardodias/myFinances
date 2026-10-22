import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { getRecurrences } = await import('./get-recurrences')
const { createRecurrence } = await import('./create-recurrence')
const { updateRecurrence } = await import('./update-recurrence')
const { dismissRecurrence } = await import('./dismiss-recurrence')

const userA = uuid('user-a')
const accountId = uuid('acc')
const otherAccountId = uuid('acc-2')
const recurrenceId = uuid('rec')

const row = {
  id: recurrenceId,
  accountId,
  description: 'NETFLIX.COM',
  direction: 'OUT',
  expectedAmountCents: 3990,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 10,
  nonBusinessDayPolicy: 'ANTICIPATE',
  status: 'SUGGESTED',
  account: { name: 'Nubank', type: 'CREDIT' },
}

const validBody = {
  accountId,
  description: 'Aluguel Apto 12',
  direction: 'OUT',
  expectedAmountCents: 250000,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 5,
}

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'POST' | 'PATCH'; url: string; body?: unknown },
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
})

describe('autenticação', () => {
  it('exige token em todas as rotas', async () => {
    const cases = [
      [getRecurrences, 'GET', '/recurrences', undefined],
      [createRecurrence, 'POST', '/recurrences', validBody],
      [updateRecurrence, 'PATCH', `/recurrences/${recurrenceId}`, { status: 'CONFIRMED' }],
      [dismissRecurrence, 'POST', `/recurrences/${recurrenceId}/dismiss`, undefined],
    ] as const
    for (const [plugin, method, url, payload] of cases) {
      const app = await buildTestApp(plugin)
      const response = await app.inject({ method, url, ...(payload ? { payload } : {}) })
      expect(response.statusCode).toBe(401)
    }
  })
})

describe('GET /recurrences', () => {
  it('lista as recorrências do usuário com a conta, filtrando por status', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([row])

    const response = await call(getRecurrences, {
      method: 'GET',
      url: '/recurrences?status=SUGGESTED',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ recurrences: [row] })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: userA,
      status: 'SUGGESTED',
    })
  })

  it('sem status lista todas', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([])
    await call(getRecurrences, { method: 'GET', url: '/recurrences' })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({ userId: userA })
  })
})

describe('POST /recurrences', () => {
  it('cria manual já CONFIRMED, com ANTICIPATE por padrão', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: accountId })
    prismaMock.recurrence.create.mockResolvedValue({ ...row, status: 'CONFIRMED' })

    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: validBody,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().recurrence.status).toBe('CONFIRMED')
    expect(prismaMock.account.findFirst.mock.calls[0][0].where).toEqual({
      id: accountId,
      userId: userA,
    })
    expect(prismaMock.recurrence.create.mock.calls[0][0].data).toEqual({
      ...validBody,
      userId: userA,
      descriptionKey: 'aluguel apto',
      nonBusinessDayPolicy: 'ANTICIPATE',
      status: 'CONFIRMED',
    })
  })

  it('responde 404 para conta de outro usuário', async () => {
    prismaMock.account.findFirst.mockResolvedValue(null)

    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: validBody,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Conta não encontrada.')
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })

  it('responde 400 para dayValue 0', async () => {
    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...validBody, dayValue: 0 },
    })
    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })

  it('responde 400 para dia útil acima de 23', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: accountId })
    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...validBody, dayRule: 'NTH_BUSINESS_DAY', dayValue: 24 },
    })
    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })

  it('responde 400 para valor não positivo', async () => {
    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...validBody, expectedAmountCents: 0 },
    })
    expect(response.statusCode).toBe(400)
  })

  it('responde 400 para descrição sem letras', async () => {
    prismaMock.account.findFirst.mockResolvedValue({ id: accountId })
    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...validBody, description: '12345' },
    })
    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })
})

describe('PATCH /recurrences/:id', () => {
  it('confirmar uma sugestão muda o status', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(row)
    prismaMock.recurrence.update.mockResolvedValue({ ...row, status: 'CONFIRMED' })

    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { status: 'CONFIRMED' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().recurrence.status).toBe('CONFIRMED')
    expect(prismaMock.recurrence.findFirst.mock.calls[0][0].where).toEqual({
      id: recurrenceId,
      userId: userA,
    })
    expect(prismaMock.recurrence.update.mock.calls[0][0]).toMatchObject({
      where: { id: recurrenceId },
      data: { status: 'CONFIRMED' },
    })
  })

  it('renomear muda só o rótulo, sem tocar na descriptionKey', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(row)
    prismaMock.recurrence.update.mockResolvedValue(row)

    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { description: 'Netflix Premium' },
    })

    expect(response.statusCode).toBe(200)
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({
      description: 'Netflix Premium',
    })
  })

  it('valida o dia contra a regra já gravada', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, dayRule: 'NTH_BUSINESS_DAY' })

    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { dayValue: 25 },
    })

    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.update).not.toHaveBeenCalled()
  })

  it('recusa trocar conta ou sentido, que são a identidade da recorrência', async () => {
    for (const body of [{ accountId: otherAccountId }, { direction: 'IN' }]) {
      const response = await call(updateRecurrence, {
        method: 'PATCH',
        url: `/recurrences/${recurrenceId}`,
        body,
      })
      expect(response.statusCode).toBe(400)
    }
    expect(prismaMock.recurrence.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.recurrence.update).not.toHaveBeenCalled()
  })

  it('responde 404 para recorrência de outro usuário', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { status: 'CONFIRMED' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('Recorrência não encontrada.')
  })

  it('não aceita outro status além de CONFIRMED', async () => {
    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { status: 'DISMISSED' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('POST /recurrences/:id/dismiss', () => {
  it('marca como DISMISSED', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(row)
    prismaMock.recurrence.update.mockResolvedValue({ ...row, status: 'DISMISSED' })

    const response = await call(dismissRecurrence, {
      method: 'POST',
      url: `/recurrences/${recurrenceId}/dismiss`,
    })

    expect(response.statusCode).toBe(204)
    expect(prismaMock.recurrence.update).toHaveBeenCalledWith({
      where: { id: recurrenceId },
      data: { status: 'DISMISSED' },
    })
  })

  it('responde 404 para recorrência de outro usuário', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(dismissRecurrence, {
      method: 'POST',
      url: `/recurrences/${recurrenceId}/dismiss`,
    })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrence.update).not.toHaveBeenCalled()
  })
})
