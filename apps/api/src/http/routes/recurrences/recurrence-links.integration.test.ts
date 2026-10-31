import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { authHeaders, buildTestApp, signToken } from '@/test/helpers'

import { createRecurrence } from './create-recurrence'
import { deleteRecurrence } from './delete-recurrence'
import { getRecurrence } from './get-recurrence'
import { getRecurrences } from './get-recurrences'
import { linkTransactions } from './link-transactions'
import { unlinkTransaction } from './unlink-transaction'
import { updateRecurrence } from './update-recurrence'

const EMAIL = 'links@recurrence-links.integration.test'

describe('vínculo de transações com recorrentes (Postgres real)', () => {
  let app: FastifyInstance
  let headers: Record<string, string>
  let userId: string
  let bankId: string
  let otherBankId: string
  const txIds: string[] = []

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    const user = await prisma.user.create({ data: { name: 'Links', email: EMAIL, passwordHash: 'x' } })
    userId = user.id
    const [bank, other] = await Promise.all(
      ['Caixa', 'Nubank'].map((name) =>
        prisma.account.create({ data: { userId, type: 'BANK', name, balanceCents: 0 } }),
      ),
    )
    bankId = bank.id
    otherBankId = other.id

    const today = todayIso()
    for (const [accountId, days] of [
      [bankId, -40],
      [otherBankId, -10],
      [bankId, -5],
    ] as const) {
      const tx = await prisma.transaction.create({
        data: {
          userId,
          accountId,
          date: toDbDate(addDays(today, days)),
          description: `PIX EMPRESTIMO ${days}`,
          descriptionKey: `pix emprestimo ${-days}`,
          amountCents: -48_000,
          status: 'POSTED',
          source: 'MANUAL',
        },
      })
      txIds.push(tx.id)
    }

    app = await buildTestApp(
      createRecurrence,
      getRecurrences,
      getRecurrence,
      updateRecurrence,
      deleteRecurrence,
      linkTransactions,
      unlinkTransaction,
    )
    headers = authHeaders(await signToken(app, { sub: userId }))
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } })
    await app.close()
  })

  async function create(description: string, extra: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/recurrences',
      headers,
      payload: { description, direction: 'OUT', expectedAmountCents: 48_000, dayRule: 'DAY_OF_MONTH', dayValue: 5, ...extra },
    })
    expect(res.statusCode).toBe(201)
    return res.json().recurrence as { id: string }
  }

  it('vincula de contas diferentes, muda de recorrente, desvincula e apagar só tira o vínculo', async () => {
    const loan = await create('Empréstimo Dr Paulo', { kind: 'LOAN', remainingInstallments: 2 })
    const other = await create('Outro')

    const link = await app.inject({
      method: 'POST',
      url: `/recurrences/${loan.id}/links`,
      headers,
      payload: { transactionIds: txIds },
    })
    expect(link.statusCode).toBe(200)

    // O "faltam 2" foi informado hoje: as parcelas vinculadas são anteriores e não descontam.
    const detail = await app.inject({ method: 'GET', url: `/recurrences/${loan.id}`, headers })
    expect(detail.json().linked.total).toBe(3)
    expect(detail.json().recurrence.loan.remaining).toBe(2)

    const moved = await app.inject({
      method: 'POST',
      url: `/recurrences/${other.id}/links`,
      headers,
      payload: { transactionIds: [txIds[0]] },
    })
    expect(moved.statusCode).toBe(200)
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: txIds[0] } })).recurrenceId).toBe(other.id)

    const unlinked = await app.inject({ method: 'DELETE', url: `/recurrences/${loan.id}/links/${txIds[1]}`, headers })
    expect(unlinked.statusCode).toBe(204)
    const again = await app.inject({ method: 'DELETE', url: `/recurrences/${loan.id}/links/${txIds[1]}`, headers })
    expect(again.statusCode).toBe(404)

    const deleted = await app.inject({ method: 'DELETE', url: `/recurrences/${loan.id}`, headers })
    expect(deleted.statusCode).toBe(204)
    const remaining = await prisma.transaction.findMany({ where: { id: { in: txIds } }, orderBy: { date: 'asc' } })
    expect(remaining.map((t) => t.recurrenceId)).toEqual([other.id, null, null])
  })

  it('a conta pode ser trocada e tirada; apagar a conta deixa o recorrente sem conta', async () => {
    const rec = await create('Internet', { accountId: bankId, dayValue: 12 })

    const moved = await app.inject({ method: 'PATCH', url: `/recurrences/${rec.id}`, headers, payload: { accountId: otherBankId } })
    expect(moved.json().recurrence.account.name).toBe('Nubank')

    await prisma.account.delete({ where: { id: otherBankId } })
    const row = await prisma.recurrence.findUniqueOrThrow({ where: { id: rec.id } })
    expect(row.accountId).toBeNull()
  })

  it('o mesmo texto, sentido e dia em outra conta é o mesmo recorrente: 409', async () => {
    await create('Academia', { accountId: bankId, dayValue: 20 })
    const res = await app.inject({
      method: 'POST',
      url: '/recurrences',
      headers,
      payload: { description: 'Academia', direction: 'OUT', expectedAmountCents: 1, dayRule: 'DAY_OF_MONTH', dayValue: 20 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('desconto em folha: o salário vale para dois empréstimos e continua sendo do salário', async () => {
    const salary = await create('Salário', { direction: 'IN', expectedAmountCents: 300_000, dayValue: 6 })
    const credit = await prisma.transaction.create({
      data: {
        userId,
        accountId: bankId,
        date: toDbDate(todayIso()),
        description: 'RECEBIMENTO TED SALARIO',
        descriptionKey: 'recebimento ted salario',
        amountCents: 300_000,
        status: 'POSTED',
        source: 'MANUAL',
        recurrenceId: salary.id,
      },
    })
    const loanA = await create('Consignado A', { kind: 'LOAN', payrollDeduction: true, remainingInstallments: 3 })
    const loanB = await create('Consignado B', { kind: 'LOAN', payrollDeduction: true, dayValue: 7 })

    for (const loan of [loanA, loanB]) {
      const res = await app.inject({
        method: 'POST',
        url: `/recurrences/${loan.id}/links`,
        headers,
        payload: { transactionIds: [credit.id] },
      })
      expect(res.statusCode).toBe(200)
    }

    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } })).recurrenceId).toBe(salary.id)
    const list = await app.inject({ method: 'GET', url: '/recurrences', headers })
    const viewA = list.json().recurrences.find((r: { id: string }) => r.id === loanA.id)
    expect(viewA).toMatchObject({ payrollDeduction: true, linkedCount: 1 })

    await app.inject({ method: 'DELETE', url: `/recurrences/${loanA.id}`, headers })
    expect(await prisma.recurrencePayrollLink.count({ where: { transactionId: credit.id } })).toBe(1)
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } })).recurrenceId).toBe(salary.id)
  })

  it('em folha, o salário que já caiu no mês é vinculado sozinho e a parcela sai paga', async () => {
    const today = todayIso()
    const day = Number(today.slice(8, 10))
    const salary = await create('Salário Base', {
      direction: 'IN',
      expectedAmountCents: 500_000,
      dayValue: day,
      nonBusinessDayPolicy: 'KEEP',
    })
    const credit = await prisma.transaction.create({
      data: {
        userId,
        accountId: bankId,
        date: toDbDate(today),
        description: 'Salário Base',
        descriptionKey: 'salario base',
        amountCents: 500_000,
        status: 'POSTED',
        source: 'MANUAL',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/recurrences',
      headers,
      payload: {
        description: 'Consignado automático',
        direction: 'OUT',
        expectedAmountCents: 40_000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 28,
        kind: 'LOAN',
        payrollDeduction: true,
        payrollSourceId: salary.id,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().recurrence).toMatchObject({
      linkedCount: 1,
      monthStatus: { state: 'PAID', date: today },
      payrollSource: { id: salary.id },
    })
    const loanId = res.json().recurrence.id
    expect(await prisma.recurrencePayrollLink.count({ where: { recurrenceId: loanId, transactionId: credit.id } })).toBe(1)
  })

  it('vincular uma parcela traz as irmãs (mesmo texto ou mesmo valor) e desvincular não volta', async () => {
    const car = await create('Financiamento Carro', { kind: 'LOAN', expectedAmountCents: 154_600, dayValue: 15 })
    const make = (days: number, descriptionKey: string, accountId: string) =>
      prisma.transaction.create({
        data: {
          userId,
          accountId,
          date: toDbDate(addDays(todayIso(), days)),
          description: descriptionKey,
          descriptionKey,
          amountCents: -154_602,
          status: 'POSTED',
          source: 'MANUAL',
        },
      })
    const first = await make(-90, 'efetuado banco c s a', bankId)
    const second = await make(-55, 'efetuado banco c s a', bankId)
    const boleto = await make(-25, 'de boleto', bankId)

    const link = await app.inject({
      method: 'POST',
      url: `/recurrences/${car.id}/links`,
      headers,
      payload: { transactionIds: [first.id] },
    })
    expect(link.statusCode).toBe(200)
    expect(link.json()).toEqual({ linked: 1, similar: 2 })
    const linkedIds = async () =>
      (await prisma.transaction.findMany({ where: { recurrenceId: car.id }, select: { id: true } })).map((t) => t.id).sort()
    expect(await linkedIds()).toEqual([first.id, second.id, boleto.id].sort())

    await app.inject({ method: 'DELETE', url: `/recurrences/${car.id}/links/${boleto.id}`, headers })
    await app.inject({ method: 'POST', url: `/recurrences/${car.id}/links`, headers, payload: { transactionIds: [first.id] } })
    expect(await linkedIds()).toEqual([first.id, second.id].sort())
  })
})
