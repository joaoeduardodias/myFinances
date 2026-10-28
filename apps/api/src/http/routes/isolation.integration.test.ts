import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { toDbDate } from '@/lib/db-date'
import { prisma } from '@/lib/prisma'
import { detectAndStoreRecurrences } from '@/services/detect-and-store-recurrences'
import { authHeaders, buildTestApp, signToken } from '@/test/helpers'

import { getAccounts } from './accounts/get-accounts'
import { getCards } from './cards/get-cards'
import { updateCardCycle } from './cards/update-card-cycle'
import { deleteConnection } from './connections/delete-connection'
import { getConnections } from './connections/get-connections'
import { syncConnectionRoute } from './connections/sync-connection'
import { getDashboard } from './dashboard/get-dashboard'
import { deletePayslip } from './payslips/delete-payslip'
import { getPayslip } from './payslips/get-payslip'
import { getPayslipFile } from './payslips/get-payslip-file'
import { getPayslips } from './payslips/get-payslips'
import { updatePayslipLines } from './payslips/update-payslip-lines'
import { dismissRecurrence } from './recurrences/dismiss-recurrence'
import { getRecurrences } from './recurrences/get-recurrences'
import { updateRecurrence } from './recurrences/update-recurrence'
import { getTransactionSimilar } from './transactions/get-transaction-similar'
import { getTransactions } from './transactions/get-transactions'
import { saveTransactionRecurrence } from './transactions/save-transaction-recurrence'
import { updateTransactionCategory } from './transactions/update-transaction-category'
import { updateTransactionDescription } from './transactions/update-transaction-description'
import { updateTransactionTransfer } from './transactions/update-transaction-transfer'

// Só o que sai do processo é simulado; o banco e as rotas são de verdade.
vi.mock('@/lib/storage', () => ({
  MAX_PAYSLIP_BYTES: 5 * 1024 * 1024,
  payslipKey: (userId: string) => `payslips/${userId}/x.pdf`,
  putFile: vi.fn(),
  deleteFile: vi.fn(),
  getSignedFileUrl: vi.fn(async () => 'https://signed.example/file.pdf'),
}))

vi.mock('@/lib/pluggy/client', () => ({
  pluggy: {
    getItem: vi.fn(),
    listAccounts: vi.fn(),
    listTransactions: vi.fn(),
    listBills: vi.fn(),
    registerWebhook: vi.fn(),
  },
}))

const EMAIL_DOMAIN = '@isolation.integration.test'

function isoMonthsAgo(months: number, day = 10) {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day))
  return d.toISOString().slice(0, 10)
}

describe('isolamento entre usuários', () => {
  let app: FastifyInstance
  let tokenB: string
  let userAId: string
  let userBId: string
  let connectionId: string
  let bankId: string
  let cardId: string
  let transactionId: string
  let recurrenceId: string
  let payslipId: string
  let walletBId: string

  async function cleanUp() {
    await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } })
  }

  beforeAll(async () => {
    await cleanUp()

    const [a, b] = await Promise.all(
      ['a', 'b'].map((name) =>
        prisma.user.create({
          data: { name: `Usuário ${name}`, email: `${name}${EMAIL_DOMAIN}`, passwordHash: 'x' },
        }),
      ),
    )
    userAId = a.id
    userBId = b.id

    const connection = await prisma.connection.create({
      data: {
        userId: userAId,
        pluggyItemId: `item-isolation-${Date.now()}`,
        connectorName: 'Banco A',
        status: 'UPDATED',
      },
    })
    connectionId = connection.id

    const bank = await prisma.account.create({
      data: {
        userId: userAId,
        connectionId,
        pluggyAccountId: `acc-bank-${Date.now()}`,
        type: 'BANK',
        name: 'Conta A',
        balanceCents: 500_000,
      },
    })
    bankId = bank.id

    const card = await prisma.account.create({
      data: {
        userId: userAId,
        connectionId,
        pluggyAccountId: `acc-card-${Date.now()}`,
        type: 'CREDIT',
        name: 'Cartão A',
        balanceCents: -90_000,
        closingDay: 20,
        dueDay: 28,
      },
    })
    cardId = card.id

    const tx = await prisma.transaction.create({
      data: {
        userId: userAId,
        accountId: bankId,
        date: toDbDate(isoMonthsAgo(0, 1)),
        description: 'Mercado A',
        descriptionKey: 'mercado a',
        amountCents: -12_000,
        status: 'POSTED',
        source: 'MANUAL',
      },
    })
    transactionId = tx.id

    const recurrence = await prisma.recurrence.create({
      data: {
        userId: userAId,
        accountId: bankId,
        description: 'Aluguel A',
        descriptionKey: 'aluguel a',
        direction: 'OUT',
        expectedAmountCents: 150_000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 5,
        status: 'SUGGESTED',
      },
    })
    recurrenceId = recurrence.id

    const payslip = await prisma.payslip.create({
      data: {
        userId: userAId,
        competence: '2026-09',
        type: 'MONTHLY',
        status: 'MANUAL',
        netCents: 400_000,
        fileKey: `payslips/${userAId}/a.pdf`,
        fileName: 'a.pdf',
        fileSha256: 'a'.repeat(64),
      },
    })
    payslipId = payslip.id

    const walletB = await prisma.account.create({
      data: { userId: userBId, type: 'WALLET', name: 'Carteira', balanceCents: 0 },
    })
    walletBId = walletB.id

    app = await buildTestApp(
      getConnections,
      deleteConnection,
      syncConnectionRoute,
      getAccounts,
      getTransactions,
      updateTransactionCategory,
      updateTransactionDescription,
      getTransactionSimilar,
      saveTransactionRecurrence,
      updateTransactionTransfer,
      getRecurrences,
      updateRecurrence,
      dismissRecurrence,
      getCards,
      updateCardCycle,
      getPayslips,
      getPayslip,
      getPayslipFile,
      updatePayslipLines,
      deletePayslip,
      getDashboard,
    )
    tokenB = await signToken(app, { sub: userBId })
  })

  afterAll(async () => {
    await app?.close()
    await cleanUp()
    await prisma.$disconnect()
  })

  const asB = () => authHeaders(tokenB)

  describe('controle positivo: A enxerga o que é dele', () => {
    it.each([
      ['/connections', 'connections'],
      ['/transactions', 'transactions'],
      ['/recurrences', 'recurrences'],
      ['/cards', 'cards'],
      ['/payslips', 'payslips'],
    ])('GET %s', async (url, key) => {
      const tokenA = await signToken(app, { sub: userAId })
      const res = await app.inject({ method: 'GET', url, headers: authHeaders(tokenA) })
      expect(res.statusCode).toBe(200)
      expect(res.json()[key]).toHaveLength(1)
    })

    it('GET /accounts de A inclui as contas dele', async () => {
      const tokenA = await signToken(app, { sub: userAId })
      const res = await app.inject({ method: 'GET', url: '/accounts', headers: authHeaders(tokenA) })
      expect(res.statusCode).toBe(200)
      const ids = res.json().accounts.map((a: { id: string }) => a.id)
      expect(ids).toEqual(expect.arrayContaining([bankId, cardId]))
    })

    it('GET /dashboard de A tem o saldo da conta dele', async () => {
      const tokenA = await signToken(app, { sub: userAId })
      const res = await app.inject({ method: 'GET', url: '/dashboard', headers: authHeaders(tokenA) })
      expect(res.statusCode).toBe(200)
      expect(res.json().balanceCents).toBe(500_000)
    })

    it('GET /payslips/:id e /file respondem 200 para A', async () => {
      const headers = authHeaders(await signToken(app, { sub: userAId }))
      for (const url of [`/payslips/${payslipId}`, `/payslips/${payslipId}/file`]) {
        const res = await app.inject({ method: 'GET', url, headers })
        expect(res.statusCode).toBe(200)
      }
    })
  })

  describe('listas de B não trazem nada de A', () => {
    it.each([
      ['/connections', 'connections'],
      ['/transactions', 'transactions'],
      ['/recurrences', 'recurrences'],
      ['/cards', 'cards'],
      ['/payslips', 'payslips'],
    ])('GET %s', async (url, key) => {
      const res = await app.inject({ method: 'GET', url, headers: asB() })
      expect(res.statusCode).toBe(200)
      expect(res.json()[key]).toEqual([])
    })

    it('GET /accounts traz só a Carteira de B', async () => {
      const res = await app.inject({ method: 'GET', url: '/accounts', headers: asB() })
      expect(res.statusCode).toBe(200)
      const { accounts } = res.json()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toMatchObject({ id: walletBId, type: 'WALLET' })
    })

    it('GET /dashboard de B tem saldo zero', async () => {
      const res = await app.inject({ method: 'GET', url: '/dashboard', headers: asB() })
      expect(res.statusCode).toBe(200)
      expect(res.json().balanceCents).toBe(0)
    })
  })

  describe('acesso por id de A com o token de B é 404', () => {
    const ids = () => ({
      connectionId,
      cardId,
      transactionId,
      recurrenceId,
      payslipId,
    })

    const cases: Array<[string, string, (i: ReturnType<typeof ids>) => string, unknown?]> = [
      ['DELETE', 'connections/:id', (i) => `/connections/${i.connectionId}`],
      ['POST', 'connections/:id/sync', (i) => `/connections/${i.connectionId}/sync`],
      [
        'PATCH',
        'transactions/:id/category',
        (i) => `/transactions/${i.transactionId}/category`,
        { category: 'Mercado' },
      ],
      [
        'PATCH',
        'transactions/:id/description',
        (i) => `/transactions/${i.transactionId}/description`,
        { description: 'Outro texto' },
      ],
      [
        'PATCH',
        'transactions/:id/description (parecidas)',
        (i) => `/transactions/${i.transactionId}/description`,
        { description: 'Outro texto', applyToSimilar: true },
      ],
      ['GET', 'transactions/:id/similar', (i) => `/transactions/${i.transactionId}/similar`],
      ['POST', 'transactions/:id/recurrence', (i) => `/transactions/${i.transactionId}/recurrence`],
      [
        'PATCH',
        'transactions/:id/transfer',
        (i) => `/transactions/${i.transactionId}/transfer`,
        { isTransfer: true },
      ],
      [
        'PATCH',
        'recurrences/:id',
        (i) => `/recurrences/${i.recurrenceId}`,
        { status: 'CONFIRMED' },
      ],
      ['POST', 'recurrences/:id/dismiss', (i) => `/recurrences/${i.recurrenceId}/dismiss`],
      ['PATCH', 'cards/:id', (i) => `/cards/${i.cardId}`, { closingDay: 1, dueDay: 8 }],
      ['GET', 'payslips/:id', (i) => `/payslips/${i.payslipId}`],
      ['GET', 'payslips/:id/file', (i) => `/payslips/${i.payslipId}/file`],
      [
        'PUT',
        'payslips/:id/lines',
        (i) => `/payslips/${i.payslipId}/lines`,
        {
          netCents: 1,
          lines: [{ kind: 'EARNING', description: 'x', reference: null, amountCents: 1 }],
        },
      ],
      ['DELETE', 'payslips/:id', (i) => `/payslips/${i.payslipId}`],
    ]

    it.each(cases)('%s %s', async (method, _label, url, payload) => {
      const res = await app.inject({
        method: method as 'GET',
        url: url(ids()),
        headers: asB(),
        payload: payload as object | undefined,
      })
      expect(res.statusCode).toBe(404)
    })

    it('POST /connections/:id/sync não chega ao Pluggy', async () => {
      const { pluggy } = await import('@/lib/pluggy/client')
      for (const fn of Object.values(pluggy)) expect(fn).not.toHaveBeenCalled()
    })

    it('nada de A foi alterado pelas tentativas de B', async () => {
      const [connection, card, tx, recurrence, payslip] = await Promise.all([
        prisma.connection.findUnique({ where: { id: connectionId } }),
        prisma.account.findUniqueOrThrow({ where: { id: cardId } }),
        prisma.transaction.findUniqueOrThrow({ where: { id: transactionId } }),
        prisma.recurrence.findUniqueOrThrow({ where: { id: recurrenceId } }),
        prisma.payslip.findUnique({ where: { id: payslipId } }),
      ])
      expect(connection).not.toBeNull()
      expect(card).toMatchObject({ closingDay: 20, dueDay: 28 })
      expect(tx).toMatchObject({ category: null, isTransfer: false })
      expect(recurrence.status).toBe('SUGGESTED')
      expect(payslip).not.toBeNull()
    })
  })

  it('recorrência descartada de A não volta como sugestão na detecção', async () => {
    const tokenA = await signToken(app, { sub: userAId })
    const dismissed = await app.inject({
      method: 'POST',
      url: `/recurrences/${recurrenceId}/dismiss`,
      headers: authHeaders(tokenA),
    })
    expect(dismissed.statusCode).toBe(204)

    // Histórico que qualifica como recorrência: mesmo lançamento, 3 meses, valor e dia estáveis.
    // Controle positivo: a mesma história sob outra descrição, sem linha de
    // Recurrence, tem de ser sugerida. Sem isso, `created === 0` valeria também
    // se o histórico semeado não qualificasse.
    await prisma.transaction.createMany({
      data: [
        ['Aluguel A', 'aluguel a', -150_000],
        ['Internet A', 'internet a', -10_000],
      ].flatMap(([description, descriptionKey, amountCents]) =>
        [1, 2, 3].map((months) => ({
          userId: userAId,
          accountId: bankId,
          date: toDbDate(isoMonthsAgo(months)),
          description: description as string,
          descriptionKey: descriptionKey as string,
          amountCents: amountCents as number,
          status: 'POSTED' as const,
          source: 'MANUAL' as const,
        })),
      ),
    })

    const created = await detectAndStoreRecurrences(userAId)

    expect(created).toBe(1)
    const rows = await prisma.recurrence.findMany({ where: { userId: userAId } })
    expect(rows).toHaveLength(2)
    expect(rows.filter((r) => r.descriptionKey === 'aluguel a')).toEqual([
      expect.objectContaining({ id: recurrenceId, status: 'DISMISSED' }),
    ])
    expect(rows.find((r) => r.descriptionKey === 'internet a')).toMatchObject({
      status: 'SUGGESTED',
    })
  })
})
