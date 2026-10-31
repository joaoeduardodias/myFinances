import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const syncPayrollLinksMock = vi.fn()
vi.mock('@/services/sync-payroll-links', () => ({ syncPayrollLinks: syncPayrollLinksMock }))

const { getRecurrences } = await import('./get-recurrences')
const { createRecurrence } = await import('./create-recurrence')
const { updateRecurrence } = await import('./update-recurrence')
const { dismissRecurrence } = await import('./dismiss-recurrence')
const { getRecurrence } = await import('./get-recurrence')
const { deleteRecurrence } = await import('./delete-recurrence')

const userA = uuid('user-a')
const accountId = uuid('acc')
const otherAccountId = uuid('acc-2')
const recurrenceId = uuid('rec')

const row = {
  id: recurrenceId,
  accountId,
  kind: 'MONTHLY',
  description: 'NETFLIX.COM',
  descriptionKey: 'netflix com',
  direction: 'OUT',
  expectedAmountCents: 3990,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 10,
  nonBusinessDayPolicy: 'ANTICIPATE',
  status: 'SUGGESTED',
  remainingInstallments: null,
  remainingAsOf: null,
  payrollDeduction: false,
  payrollSourceId: null as string | null,
  transactions: [] as { date: Date }[],
  payrollLinks: [] as { transaction: { date: Date } }[],
  account: { name: 'Nubank', type: 'CREDIT' },
}

/** O que a API devolve de `row`: sem a chave e as datas internas, com o resumo calculado. */
const rowView = {
  id: recurrenceId,
  accountId,
  kind: 'MONTHLY',
  description: 'NETFLIX.COM',
  direction: 'OUT',
  expectedAmountCents: 3990,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 10,
  nonBusinessDayPolicy: 'ANTICIPATE',
  status: 'SUGGESTED',
  remainingInstallments: null,
  payrollDeduction: false,
  payrollSourceId: null,
  payrollSource: null,
  account: { name: 'Nubank', type: 'CREDIT' },
  paidOff: false,
  monthStatus: null,
  linkedCount: 0,
  lastLinkedDate: null,
  loan: null,
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
  opts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; body?: unknown },
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
  prismaMock.transaction.findMany.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('autenticação', () => {
  it('exige token em todas as rotas', async () => {
    const cases = [
      [getRecurrences, 'GET', '/recurrences', undefined],
      [createRecurrence, 'POST', '/recurrences', validBody],
      [updateRecurrence, 'PATCH', `/recurrences/${recurrenceId}`, { status: 'CONFIRMED' }],
      [dismissRecurrence, 'POST', `/recurrences/${recurrenceId}/dismiss`, undefined],
      [getRecurrence, 'GET', `/recurrences/${recurrenceId}`, undefined],
      [deleteRecurrence, 'DELETE', `/recurrences/${recurrenceId}`, undefined],
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
    expect(response.json()).toEqual({ recurrences: [rowView] })
    expect(prismaMock.recurrence.findMany.mock.calls[0][0].where).toEqual({
      userId: userA,
      status: 'SUGGESTED',
    })
  })

  it('confirmado traz o status do mês, os vínculos e, no empréstimo, as parcelas e o término', async () => {
    const loan = {
      ...row,
      kind: 'LOAN',
      status: 'CONFIRMED',
      account: null,
      accountId: null,
      remainingInstallments: 8,
      remainingAsOf: new Date('2026-09-01T00:00:00Z'),
      transactions: [{ date: new Date('2026-09-10T00:00:00Z') }, { date: new Date('2026-10-09T00:00:00Z') }],
    }
    prismaMock.recurrence.findMany.mockResolvedValue([loan])
    prismaMock.transaction.findMany.mockResolvedValue([
      {
        accountId,
        date: new Date('2026-10-09T00:00:00Z'),
        amountCents: -3990,
        descriptionKey: 'pix',
        isTransfer: false,
        recurrenceId,
      },
    ])

    const response = await call(getRecurrences, { method: 'GET', url: '/recurrences' })

    expect(response.json().recurrences[0]).toMatchObject({
      accountId: null,
      account: null,
      monthStatus: { state: 'PAID', date: '2026-10-09', days: 0 },
      linkedCount: 2,
      lastLinkedDate: '2026-10-09',
      paidOff: false,
      // 8 informadas em 01/09, duas pagas depois: faltam 6, a de outubro já foi.
      loan: { remaining: 6, remainingCents: 6 * 3990, endMonth: '2027-04' },
    })
    expect(prismaMock.transaction.findMany.mock.calls[0][0].where.userId).toBe(userA)
  })

  it('empréstimo em folha conta como paga a parcela do salário vinculado', async () => {
    prismaMock.recurrence.findMany.mockResolvedValue([
      {
        ...row,
        kind: 'LOAN',
        status: 'CONFIRMED',
        dayValue: 5,
        payrollDeduction: true,
        remainingInstallments: 8,
        remainingAsOf: new Date('2026-09-01T00:00:00Z'),
        payrollLinks: [{ transaction: { date: new Date('2026-10-06T00:00:00Z') } }],
      },
    ])

    const response = await call(getRecurrences, { method: 'GET', url: '/recurrences' })

    expect(response.json().recurrences[0]).toMatchObject({
      payrollDeduction: true,
      linkedCount: 1,
      lastLinkedDate: '2026-10-06',
      monthStatus: { state: 'PAID', date: '2026-10-06' },
      loan: { remaining: 7 },
    })
  })

  it('em folha vence com o salário de que é descontado, não no dia do empréstimo', async () => {
    const salary = {
      ...row,
      id: uuid('salary'),
      description: 'RECEBIMENTO TED SALARIO',
      descriptionKey: 'recebimento ted salario',
      direction: 'IN',
      status: 'CONFIRMED',
      expectedAmountCents: 297000,
      dayRule: 'NTH_BUSINESS_DAY',
      dayValue: 4,
    }
    const loan = { ...row, kind: 'LOAN', status: 'CONFIRMED', dayValue: 25, payrollDeduction: true }
    prismaMock.recurrence.findMany.mockResolvedValue([loan, salary])

    const response = await call(getRecurrences, { method: 'GET', url: '/recurrences' })

    expect(response.json().recurrences[0]).toMatchObject({
      payrollSource: { id: uuid('salary'), description: 'RECEBIMENTO TED SALARIO' },
      monthStatus: { state: 'LATE', date: '2026-10-06', days: 14 },
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
      kind: 'MONTHLY',
      userId: userA,
      descriptionKey: 'aluguel apto',
      nonBusinessDayPolicy: 'ANTICIPATE',
      status: 'CONFIRMED',
    })
  })

  it('cria sem conta, que vale para qualquer uma', async () => {
    prismaMock.recurrence.create.mockResolvedValue({ ...row, accountId: null, account: null, status: 'CONFIRMED' })
    const { accountId: _omit, ...withoutAccount } = validBody

    const response = await call(createRecurrence, { method: 'POST', url: '/recurrences', body: withoutAccount })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.account.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.recurrence.create.mock.calls[0][0].data.accountId).toBeUndefined()
  })

  it('empréstimo grava as parcelas que faltam com o dia de hoje', async () => {
    prismaMock.recurrence.create.mockResolvedValue({ ...row, kind: 'LOAN', status: 'CONFIRMED' })
    const { accountId: _omit, ...withoutAccount } = validBody

    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...withoutAccount, kind: 'LOAN', remainingInstallments: 8 },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.recurrence.create.mock.calls[0][0].data).toMatchObject({
      kind: 'LOAN',
      remainingInstallments: 8,
      remainingAsOf: new Date('2026-10-20T00:00:00Z'),
    })
  })

  it('desconto em folha só vale para saída mensal ou empréstimo', async () => {
    const { accountId: _omit, ...withoutAccount } = validBody
    for (const body of [
      { ...withoutAccount, kind: 'EXTERNAL', payrollDeduction: true },
      { ...withoutAccount, kind: 'MONTHLY', direction: 'IN', payrollDeduction: true },
      { ...withoutAccount, kind: 'LOAN', direction: 'IN', payrollDeduction: true },
    ]) {
      const response = await call(createRecurrence, { method: 'POST', url: '/recurrences', body })
      expect(response.statusCode).toBe(400)
    }
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()

    prismaMock.recurrence.create.mockResolvedValue({ ...row, kind: 'LOAN', status: 'CONFIRMED' })
    const ok = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...withoutAccount, kind: 'LOAN', payrollDeduction: true },
    })
    expect(ok.statusCode).toBe(201)
    expect(prismaMock.recurrence.create.mock.calls[0][0].data).toMatchObject({ payrollDeduction: true })

    // Mensal de saída também: plano de saúde, sindicato (pedido do João).
    const monthly = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...withoutAccount, kind: 'MONTHLY', payrollDeduction: true },
    })
    expect(monthly.statusCode).toBe(201)
    expect(prismaMock.recurrence.create.mock.calls[1][0].data).toMatchObject({
      kind: 'MONTHLY',
      payrollDeduction: true,
    })
  })

  it('em folha guarda o recebimento escolhido e já vincula os salários', async () => {
    prismaMock.recurrence.findFirst
      .mockResolvedValueOnce({ id: uuid('salary'), kind: 'MONTHLY', direction: 'IN', status: 'CONFIRMED' })
      .mockResolvedValueOnce({ ...row, kind: 'LOAN', status: 'CONFIRMED', payrollDeduction: true })
    prismaMock.recurrence.findMany.mockResolvedValue([])
    prismaMock.recurrence.create.mockResolvedValue({ ...row, kind: 'LOAN', status: 'CONFIRMED', payrollDeduction: true })
    const { accountId: _omit, ...withoutAccount } = validBody

    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...withoutAccount, kind: 'LOAN', payrollDeduction: true, payrollSourceId: uuid('salary') },
    })

    expect(response.statusCode).toBe(201)
    expect(prismaMock.recurrence.findFirst.mock.calls[0][0].where).toEqual({ id: uuid('salary'), userId: userA })
    expect(prismaMock.recurrence.create.mock.calls[0][0].data).toMatchObject({ payrollSourceId: uuid('salary') })
    expect(syncPayrollLinksMock).toHaveBeenCalledWith(userA, '2026-10-20')
  })

  it('recebimento de outro usuário dá 404; o que não é recebimento mensal, 400', async () => {
    const { accountId: _omit, ...withoutAccount } = validBody
    const body = { ...withoutAccount, kind: 'LOAN', payrollDeduction: true, payrollSourceId: uuid('salary') }

    prismaMock.recurrence.findFirst.mockResolvedValueOnce(null)
    expect((await call(createRecurrence, { method: 'POST', url: '/recurrences', body })).statusCode).toBe(404)

    prismaMock.recurrence.findFirst.mockResolvedValueOnce({ id: uuid('salary'), kind: 'LOAN', direction: 'OUT', status: 'CONFIRMED' })
    expect((await call(createRecurrence, { method: 'POST', url: '/recurrences', body })).statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
  })

  it('parcelas fora de empréstimo dão 400', async () => {
    const response = await call(createRecurrence, {
      method: 'POST',
      url: '/recurrences',
      body: { ...validBody, kind: 'MONTHLY', remainingInstallments: 8 },
    })
    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.create).not.toHaveBeenCalled()
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

  it('recusa trocar o sentido, que é a identidade da recorrência', async () => {
    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { direction: 'IN' },
    })
    expect(response.statusCode).toBe(400)
    expect(prismaMock.recurrence.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.recurrence.update).not.toHaveBeenCalled()
  })

  it('troca ou tira a conta: ela não prende mais o recorrente', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(row)
    prismaMock.recurrence.update.mockResolvedValue(row)
    prismaMock.account.findFirst.mockResolvedValue({ id: otherAccountId })

    const moved = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { accountId: otherAccountId },
    })
    expect(moved.statusCode).toBe(200)
    expect(prismaMock.account.findFirst.mock.calls[0][0].where).toEqual({ id: otherAccountId, userId: userA })
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({ accountId: otherAccountId })

    const cleared = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { accountId: null },
    })
    expect(cleared.statusCode).toBe(200)
    expect(prismaMock.recurrence.update.mock.calls[1][0].data).toEqual({ accountId: null })
  })

  it('conta de outro usuário dá 404', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(row)
    prismaMock.account.findFirst.mockResolvedValue(null)
    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { accountId: otherAccountId },
    })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrence.update).not.toHaveBeenCalled()
  })

  it('virar empréstimo com parcelas grava o dia de hoje; quitar à mão só no empréstimo', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, status: 'CONFIRMED' })
    prismaMock.recurrence.update.mockResolvedValue(row)

    const loan = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { kind: 'LOAN', remainingInstallments: 5 },
    })
    expect(loan.statusCode).toBe(200)
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({
      kind: 'LOAN',
      remainingInstallments: 5,
      remainingAsOf: new Date('2026-10-20T00:00:00Z'),
    })

    const paidOff = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { status: 'PAID_OFF' },
    })
    expect(paidOff.statusCode).toBe(400)
  })

  it('quitar empréstimo à mão', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, kind: 'LOAN', status: 'CONFIRMED' })
    prismaMock.recurrence.update.mockResolvedValue({ ...row, kind: 'LOAN', status: 'PAID_OFF' })
    const response = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { status: 'PAID_OFF' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().recurrence.paidOff).toBe(true)
  })

  it('deixar de ser empréstimo limpa as parcelas e reabre o quitado; mensal mantém o desconto em folha', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, kind: 'LOAN', status: 'PAID_OFF', payrollDeduction: true })
    prismaMock.recurrence.update.mockResolvedValue(row)
    await call(updateRecurrence, { method: 'PATCH', url: `/recurrences/${recurrenceId}`, body: { kind: 'MONTHLY' } })
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({
      kind: 'MONTHLY',
      remainingInstallments: null,
      remainingAsOf: null,
      status: 'CONFIRMED',
    })
  })

  it('virar fora da Pluggy desliga o desconto em folha', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, status: 'CONFIRMED', payrollDeduction: true })
    prismaMock.recurrence.update.mockResolvedValue(row)
    await call(updateRecurrence, { method: 'PATCH', url: `/recurrences/${recurrenceId}`, body: { kind: 'EXTERNAL' } })
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({
      kind: 'EXTERNAL',
      payrollDeduction: false,
      payrollSourceId: null,
    })
  })

  it('liga o desconto em folha na saída mensal ou no empréstimo; fora da Pluggy dá 400', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, kind: 'LOAN', status: 'CONFIRMED' })
    prismaMock.recurrence.update.mockResolvedValue(row)
    const ok = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { payrollDeduction: true },
    })
    expect(ok.statusCode).toBe(200)
    expect(prismaMock.recurrence.update.mock.calls[0][0].data).toEqual({ payrollDeduction: true })

    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, status: 'CONFIRMED' })
    const monthly = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { payrollDeduction: true },
    })
    expect(monthly.statusCode).toBe(200)

    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, kind: 'EXTERNAL', status: 'CONFIRMED' })
    const bad = await call(updateRecurrence, {
      method: 'PATCH',
      url: `/recurrences/${recurrenceId}`,
      body: { payrollDeduction: true },
    })
    expect(bad.statusCode).toBe(400)
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

describe('DELETE /recurrences/:id', () => {
  it('apaga; as transações ficam e perdem o vínculo pelo banco', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ id: recurrenceId })
    const response = await call(deleteRecurrence, { method: 'DELETE', url: `/recurrences/${recurrenceId}` })
    expect(response.statusCode).toBe(204)
    expect(prismaMock.recurrence.findFirst.mock.calls[0][0].where).toEqual({ id: recurrenceId, userId: userA })
    expect(prismaMock.recurrence.delete).toHaveBeenCalledWith({ where: { id: recurrenceId } })
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(deleteRecurrence, { method: 'DELETE', url: `/recurrences/${recurrenceId}` })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrence.delete).not.toHaveBeenCalled()
  })
})

describe('GET /recurrences/:id', () => {
  const tx = (id: string, date: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
    id: uuid(id),
    accountId,
    date: new Date(`${date}T00:00:00Z`),
    amountCents,
    description: 'NETFLIX.COM',
    descriptionKey: 'netflix com',
    isTransfer: false,
    recurrenceId: null,
    account: { name: 'Nubank' },
    ...extra,
  })

  it('traz os 6 meses, as vinculadas e as parecidas ainda sem vínculo', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({
      ...row,
      status: 'CONFIRMED',
      transactions: [{ date: new Date('2026-09-10T00:00:00Z') }],
    })
    prismaMock.transaction.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.recurrenceId === recurrenceId) {
        return [tx('linked', '2026-09-10', -3990, { recurrenceId })]
      }
      return [
        tx('linked', '2026-09-10', -3990, { recurrenceId }),
        tx('match', '2026-10-10', -4100),
        tx('other', '2026-10-10', -3990, { descriptionKey: 'mercado', accountId: uuid('acc-3') }),
      ]
    })
    prismaMock.transaction.count.mockResolvedValue(1)
    prismaMock.recurrenceLinkDismissal.findMany.mockResolvedValue([])

    const response = await call(getRecurrence, { method: 'GET', url: `/recurrences/${recurrenceId}` })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.recurrence.id).toBe(recurrenceId)
    expect(body.months).toEqual([
      { month: '2026-05', amountCents: 0 },
      { month: '2026-06', amountCents: 0 },
      { month: '2026-07', amountCents: 0 },
      { month: '2026-08', amountCents: 0 },
      { month: '2026-09', amountCents: 3990 },
      { month: '2026-10', amountCents: 4100 },
    ])
    expect(body.linked).toEqual({
      total: 1,
      items: [{ id: uuid('linked'), date: '2026-09-10', description: 'NETFLIX.COM', amountCents: -3990, account: { name: 'Nubank' } }],
    })
    expect(body.suggestions.map((t: { id: string }) => t.id)).toEqual([uuid('match')])
  })

  it('o "Não é" tira a transação das parecidas', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, status: 'CONFIRMED' })
    prismaMock.transaction.findMany.mockResolvedValue([tx('match', '2026-10-10', -4100)])
    prismaMock.transaction.count.mockResolvedValue(0)
    prismaMock.recurrenceLinkDismissal.findMany.mockResolvedValue([{ transactionId: uuid('match') }])

    const response = await call(getRecurrence, { method: 'GET', url: `/recurrences/${recurrenceId}` })

    expect(response.json().suggestions).toEqual([])
  })

  it('em folha lista os salários vinculados e não sugere', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({
      ...row,
      kind: 'LOAN',
      status: 'CONFIRMED',
      payrollDeduction: true,
      payrollLinks: [{ transaction: { date: new Date('2026-10-06T00:00:00Z') } }],
    })
    prismaMock.transaction.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      args.where.payrollLinks ? [tx('salary', '2026-10-06', 300000)] : [tx('match', '2026-10-10', -4100)],
    )
    prismaMock.transaction.count.mockResolvedValue(1)
    prismaMock.recurrenceLinkDismissal.findMany.mockResolvedValue([])

    const response = await call(getRecurrence, { method: 'GET', url: `/recurrences/${recurrenceId}` })

    const body = response.json()
    expect(body.linked.items.map((t: { id: string }) => t.id)).toEqual([uuid('salary')])
    expect(body.suggestions).toEqual([])
    // A parcela do mês conta pelo salário vinculado, não por saídas parecidas.
    expect(body.months.at(-1)).toEqual({ month: '2026-10', amountCents: 3990 })
    expect(body.months.at(-2)).toEqual({ month: '2026-09', amountCents: 0 })
    const linkedQuery = prismaMock.transaction.findMany.mock.calls.find(([args]) => args.where.payrollLinks)?.[0]
    expect(linkedQuery.where).toEqual({ userId: userA, payrollLinks: { some: { recurrenceId } } })
  })

  it('fora da Pluggy não sugere nada', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue({ ...row, kind: 'EXTERNAL', status: 'CONFIRMED' })
    prismaMock.transaction.findMany.mockResolvedValue([tx('match', '2026-10-10', -4100)])
    prismaMock.transaction.count.mockResolvedValue(0)
    prismaMock.recurrenceLinkDismissal.findMany.mockResolvedValue([])

    const response = await call(getRecurrence, { method: 'GET', url: `/recurrences/${recurrenceId}` })

    expect(response.json().suggestions).toEqual([])
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.recurrence.findFirst.mockResolvedValue(null)
    const response = await call(getRecurrence, { method: 'GET', url: `/recurrences/${recurrenceId}` })
    expect(response.statusCode).toBe(404)
    expect(prismaMock.recurrence.findFirst.mock.calls[0][0].where).toEqual({ id: recurrenceId, userId: userA })
  })
})
