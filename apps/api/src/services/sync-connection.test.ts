import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluggyClient } from '@/lib/pluggy/client'
import type {
  PluggyAccount,
  PluggyItem,
  PluggyTransaction,
} from '@/lib/pluggy/types'
import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()

const detectAndStoreRecurrencesMock = vi.fn()
const checkAlertsMock = vi.fn()
const refreshSummaryMock = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/services/check-alerts', () => ({
  checkAlertsSafely: async (...args: unknown[]) => {
    try {
      await checkAlertsMock(...args)
    } catch {}
  },
}))
vi.mock('@/services/advisor-summary', () => ({
  refreshAdvisorSummaryInBackground: refreshSummaryMock,
}))
const syncPayrollLinksMock = vi.fn()
vi.mock('./sync-payroll-links', () => ({ syncPayrollLinks: syncPayrollLinksMock }))
const linkSimilarMock = vi.fn()
vi.mock('./link-similar-transactions', () => ({ linkSimilarTransactions: linkSimilarMock }))
vi.mock('./detect-and-store-recurrences', () => ({
  detectAndStoreRecurrences: detectAndStoreRecurrencesMock,
}))

const { syncConnection } = await import('./sync-connection')

const USER = 'user-1'
const TODAY = '2026-10-22'

const connection = {
  id: 'conn-1',
  userId: USER,
  pluggyItemId: 'item-1',
  connectorName: 'Meu Pluggy',
  status: 'UPDATING',
  consentExpiresAt: null,
  lastSyncedAt: null as Date | null,
  lastError: null,
}

const item: PluggyItem = {
  id: 'item-1',
  status: 'UPDATED',
  connector: { name: 'Meu Pluggy' },
  consentExpiresAt: '2027-04-01T00:00:00.000Z',
  error: null,
}

const bankAccount: PluggyAccount = {
  id: 'p-acc-new',
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: 'Conta corrente',
  number: '123',
  balance: 1500.5,
}

function pluggyTx(extra: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return {
    id: 'p-tx-1',
    accountId: 'p-acc-new',
    date: '2026-10-10T03:00:00.000Z',
    description: 'IFOOD *RESTAURANTE',
    amount: 42.9,
    type: 'DEBIT',
    status: 'POSTED',
    category: 'Food delivery',
    creditCardMetadata: null,
    ...extra,
  }
}

function makeClient(over: Partial<PluggyClient> = {}): PluggyClient {
  return {
    getItem: vi.fn(async () => item),
    listAccounts: vi.fn(async () => [bankAccount]),
    listTransactions: vi.fn(async () => [pluggyTx()]),
    listBills: vi.fn(async () => []),
    registerWebhook: vi.fn(async () => undefined),
    createConnectToken: vi.fn(async () => 'connect-token'),
    ...over,
  }
}

type PairingRow = {
  id: string
  accountId: string
  date: Date
  description: string
  amountCents: number
  isTransfer: boolean
  transferLocked: boolean
  transferPairId: string | null
  transferPairOf: { id: string } | null
  account: { type: 'BANK' | 'CREDIT' | 'WALLET' }
  originalDescription?: string | null
}

let existingTxs: {
  pluggyTransactionId: string
  userId: string
  categoryLocked: boolean
  accountId: string
  descriptionLocked?: boolean
  descriptionKey?: string
  date?: Date
  amountCents?: number
  status?: string
  description?: string
  originalDescription?: string | null
  category?: string | null
}[]
let pairingRows: PairingRow[]
let manualRows: ManualRow[]
let removedRows: { id: string; transferPair: unknown; transferPairOf: unknown }[]

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock))
  existingTxs = []
  pairingRows = []
  manualRows = []
  removedRows = []

  prismaMock.connection.findUnique.mockResolvedValue({ ...connection })
  prismaMock.connection.update.mockResolvedValue({})
  prismaMock.account.findMany.mockResolvedValue([])
  prismaMock.account.upsert.mockImplementation(async ({ create }) => ({
    id: `db-${create.pluggyAccountId}`,
    ...create,
  }))
  prismaMock.account.findFirst.mockImplementation(async ({ where }) =>
    where.type === 'WALLET' ? { id: 'wallet-1', type: 'WALLET' } : null,
  )
  prismaMock.account.update.mockResolvedValue({})
  // A leitura antes do upsert pede `in`; a das que sumiram da Pluggy, `notIn`;
  // a dos lançamentos do WhatsApp, `whatsappMessageId`.
  prismaMock.transaction.findMany.mockImplementation(async ({ where }) =>
    where.pluggyTransactionId?.in
      ? existingTxs
      : where.pluggyTransactionId?.notIn
        ? removedRows
        : where.whatsappMessageId
          ? manualRows
          : pairingRows,
  )
  prismaMock.transaction.upsert.mockResolvedValue({})
  prismaMock.transaction.update.mockResolvedValue({})
  prismaMock.transaction.create.mockImplementation(async ({ data }) => ({
    id: 'system-1',
    ...data,
  }))
  prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  prismaMock.cardBill.upsert.mockResolvedValue({})
  prismaMock.transaction.deleteMany.mockResolvedValue({ count: 0 })
  prismaMock.transaction.delete.mockResolvedValue({})
  detectAndStoreRecurrencesMock.mockReset()
  checkAlertsMock.mockReset()
  refreshSummaryMock.mockReset()
  detectAndStoreRecurrencesMock.mockResolvedValue(0)
  syncPayrollLinksMock.mockReset()
  syncPayrollLinksMock.mockResolvedValue(0)
  linkSimilarMock.mockReset()
  linkSimilarMock.mockResolvedValue(0)
})

describe('syncConnection', () => {
  it('atualiza o item e grava lastSyncedAt e lastError nulo no fim', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.connection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: {
        status: 'UPDATED',
        connectorName: 'Meu Pluggy',
        consentExpiresAt: new Date('2027-04-01T00:00:00.000Z'),
        lastError: null,
      },
    })
    const last = prismaMock.connection.update.mock.calls.at(-1)?.[0]
    expect(last.data.lastSyncedAt).toBeInstanceOf(Date)
    expect(last.data.lastError).toBeNull()
  })

  it('detecta recorrentes do usuário antes de gravar lastSyncedAt', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(detectAndStoreRecurrencesMock).toHaveBeenCalledWith(USER, TODAY)
    const detectOrder = detectAndStoreRecurrencesMock.mock.invocationCallOrder[0]
    const lastUpdateOrder = prismaMock.connection.update.mock.invocationCallOrder.at(-1)!
    expect(detectOrder).toBeLessThan(lastUpdateOrder)
    expect(prismaMock.connection.update.mock.calls.at(-1)?.[0].data.lastSyncedAt).toBeInstanceOf(
      Date,
    )
  })

  it('vincula o salário aos empréstimos em folha antes de conferir os alarmes', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })
    expect(syncPayrollLinksMock).toHaveBeenCalledWith(USER, TODAY)
    expect(syncPayrollLinksMock.mock.invocationCallOrder[0]).toBeLessThan(checkAlertsMock.mock.invocationCallOrder[0])
  })

  it('vincula as parcelas novas que repetem o padrão das vinculadas, antes dos alarmes', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })
    expect(linkSimilarMock).toHaveBeenCalledWith(USER, { today: TODAY })
    expect(linkSimilarMock.mock.invocationCallOrder[0]).toBeLessThan(checkAlertsMock.mock.invocationCallOrder[0])
  })

  it('confere os alarmes depois de detectar recorrentes', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })
    expect(checkAlertsMock).toHaveBeenCalledWith(USER, TODAY)
    expect(checkAlertsMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      detectAndStoreRecurrencesMock.mock.invocationCallOrder[0],
    )
  })

  it('transação nova dispara o resumo do consultor', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })
    expect(refreshSummaryMock).toHaveBeenCalledWith(USER, TODAY)
  })

  it('só transações já gravadas e iguais: confere alarmes, mas não chama o resumo', async () => {
    existingTxs = [
      {
        pluggyTransactionId: 'p-tx-1',
        userId: USER,
        categoryLocked: false,
        accountId: 'db-p-acc-new',
        descriptionLocked: false,
        descriptionKey: 'ifood restaurante',
        date: new Date('2026-10-10T00:00:00Z'),
        amountCents: -4290,
        status: 'POSTED',
        description: 'IFOOD *RESTAURANTE',
        originalDescription: null,
        category: 'Delivery',
      },
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(checkAlertsMock).toHaveBeenCalledWith(USER, TODAY)
    expect(refreshSummaryMock).not.toHaveBeenCalled()
  })

  it('transação gravada com valor diferente dispara o resumo', async () => {
    existingTxs = [
      {
        pluggyTransactionId: 'p-tx-1',
        userId: USER,
        categoryLocked: false,
        accountId: 'db-p-acc-new',
        date: new Date('2026-10-10T00:00:00Z'),
        amountCents: -1000,
        status: 'POSTED',
        description: 'IFOOD *RESTAURANTE',
        category: 'Delivery',
      },
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(refreshSummaryMock).toHaveBeenCalledWith(USER, TODAY)
  })

  it('transação que sumiu da Pluggy dispara o resumo', async () => {
    existingTxs = [
      {
        pluggyTransactionId: 'p-tx-1',
        userId: USER,
        categoryLocked: false,
        accountId: 'db-p-acc-new',
        date: new Date('2026-10-10T00:00:00Z'),
        amountCents: -4290,
        status: 'POSTED',
        description: 'IFOOD *RESTAURANTE',
        category: 'Delivery',
      },
    ]
    removedRows = [{ id: 'gone', transferPair: null, transferPairOf: null }]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(refreshSummaryMock).toHaveBeenCalledWith(USER, TODAY)
  })

  it('falha no alarme não impede a sincronização', async () => {
    checkAlertsMock.mockRejectedValue(new Error('alarme'))
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })
    const data = prismaMock.connection.update.mock.calls.at(-1)?.[0].data
    expect(data.lastSyncedAt).toBeInstanceOf(Date)
    expect(data.lastError).toBeFalsy()
  })

  it('na primeira sincronização busca desde today − 365', async () => {
    const client = makeClient()

    await syncConnection('conn-1', { client, today: TODAY })

    expect(client.listTransactions).toHaveBeenCalledWith('p-acc-new', '2025-10-22')
  })

  it('depois da primeira, busca desde lastSyncedAt − 30 dias', async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      ...connection,
      lastSyncedAt: new Date('2026-10-20T15:00:00Z'),
    })
    const client = makeClient()

    await syncConnection('conn-1', { client, today: TODAY })

    expect(client.listTransactions).toHaveBeenCalledWith('p-acc-new', '2026-09-20')
  })

  it('faz upsert da conta com o saldo em centavos', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const call = prismaMock.account.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ pluggyAccountId: 'p-acc-new', userId: USER })
    expect(call.create).toMatchObject({
      userId: USER,
      connectionId: 'conn-1',
      type: 'BANK',
      name: 'Conta corrente',
      balanceCents: 150050,
    })
    expect(call.update).toMatchObject({ connectionId: 'conn-1', balanceCents: 150050 })
  })

  it('preenche dueDay e closingDay do cartão só quando ainda estão nulos', async () => {
    const card: PluggyAccount = {
      id: 'p-card',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Cartão',
      balance: 800,
      creditData: { balanceDueDate: '2026-11-05' },
    }
    prismaMock.account.findMany.mockResolvedValue([
      { id: 'db-p-card', pluggyAccountId: 'p-card', userId: USER, dueDay: 12, closingDay: null },
    ])
    const client = makeClient({ listAccounts: vi.fn(async () => [card]) })

    await syncConnection('conn-1', { client, today: TODAY })

    const call = prismaMock.account.upsert.mock.calls[0][0]
    expect(call.create).toMatchObject({ dueDay: 5, closingDay: 29 })
    expect(call.update).not.toHaveProperty('dueDay')
    expect(call.update).toMatchObject({ closingDay: 29 })
  })

  it('grava o limite do cartão em centavos e nulo quando a Pluggy não manda', async () => {
    const card: PluggyAccount = {
      id: 'p-card',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Cartão',
      balance: 800,
      creditData: { creditLimit: 5847.07 },
    }
    const client = makeClient({ listAccounts: vi.fn(async () => [card, bankAccount]) })

    await syncConnection('conn-1', { client, today: TODAY })

    const [cardCall, bankCall] = prismaMock.account.upsert.mock.calls.map((c) => c[0])
    expect(cardCall.update).toMatchObject({ creditLimitCents: 584707 })
    expect(bankCall.update).toMatchObject({ creditLimitCents: null })
  })

  it('grava na conexão o código do banco tirado do número de transferência', async () => {
    const client = makeClient({
      listAccounts: vi.fn(async () => [
        { ...bankAccount, bankData: { transferNumber: '104/4730/589037271-4' } },
      ]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.connection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { institutionCode: '104' },
    })
  })

  it('conta de banco conhecido vira "<tipo> <banco>"; desconhecido mantém o nome', async () => {
    const card: PluggyAccount = {
      id: 'p-card',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'ELO MAIS',
      balance: 0,
    }
    const bank = (transferNumber: string) => ({ ...bankAccount, bankData: { transferNumber } })
    const savings: PluggyAccount = {
      ...bankAccount,
      id: 'p-savings',
      subtype: 'SAVINGS_ACCOUNT',
      name: 'Poupança',
    }

    await syncConnection('conn-1', {
      client: makeClient({
        listAccounts: vi.fn(async () => [card, bank('237/1544/1-5'), savings]),
      }),
      today: TODAY,
    })
    expect(prismaMock.account.upsert.mock.calls.map((c) => c[0].update.name)).toEqual([
      'Cartão Crédito Bradesco',
      'Conta Corrente Bradesco',
      'Conta Poupança Bradesco',
    ])

    prismaMock.account.upsert.mockClear()
    await syncConnection('conn-1', {
      client: makeClient({ listAccounts: vi.fn(async () => [card, bank('999/1/1')]) }),
      today: TODAY,
    })
    expect(prismaMock.account.upsert.mock.calls[0][0].update).toMatchObject({ name: 'ELO MAIS' })
  })

  it('sem conta bancária, não mexe no código do banco', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const datas = prismaMock.connection.update.mock.calls.map((c) => c[0].data)
    expect(datas.some((d) => 'institutionCode' in d)).toBe(false)
  })

  it('faz upsert da transação com centavos, chave e categoria da Pluggy', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const call = prismaMock.transaction.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ pluggyTransactionId: 'p-tx-1', userId: USER })
    expect(call.create).toMatchObject({
      userId: USER,
      accountId: 'db-p-acc-new',
      pluggyTransactionId: 'p-tx-1',
      date: new Date('2026-10-10T00:00:00Z'),
      amountCents: -4290,
      descriptionKey: 'ifood restaurante',
      status: 'POSTED',
      source: 'PLUGGY',
      pluggyCategory: 'Food delivery',
      category: 'Delivery',
    })
  })

  it('data com hora vale o dia no fuso do usuário; meia-noite UTC é a data civil', async () => {
    const client = makeClient({
      listTransactions: vi.fn(async () => [
        pluggyTx({ id: 'late', date: '2026-10-11T01:30:00.000Z' }),
        pluggyTx({ id: 'civil', date: '2026-10-11T00:00:00.000Z' }),
      ]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    const dates = prismaMock.transaction.upsert.mock.calls.map(([args]) => args.create.date)
    expect(dates).toEqual([new Date('2026-10-10T00:00:00Z'), new Date('2026-10-11T00:00:00Z')])
  })

  it('o mesmo pluggyTransactionId numa conta nova (item renovado) faz update, não create', async () => {
    existingTxs = [
      { pluggyTransactionId: 'p-tx-1', userId: USER, categoryLocked: false, accountId: 'db-old' },
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.upsert).toHaveBeenCalledTimes(1)
    const call = prismaMock.transaction.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ pluggyTransactionId: 'p-tx-1', userId: USER })
    expect(call.update).toMatchObject({ accountId: 'db-p-acc-new', amountCents: -4290 })
    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
  })

  it('não toca na transação que já é de outro usuário', async () => {
    existingTxs = [{ pluggyTransactionId: 'p-tx-1', userId: 'other', categoryLocked: false, accountId: 'x' }]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.upsert).not.toHaveBeenCalled()
  })

  it('categoria travada não é sobrescrita', async () => {
    existingTxs = [{ pluggyTransactionId: 'p-tx-1', userId: USER, categoryLocked: true, accountId: 'db-p-acc-new' }]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const call = prismaMock.transaction.upsert.mock.calls[0][0]
    expect(call.update).not.toHaveProperty('category')
    expect(call.update.pluggyCategory).toBe('Food delivery')
  })

  it('não sobrescreve descrição travada', async () => {
    existingTxs = [
      {
        pluggyTransactionId: 'p-tx-1',
        userId: USER,
        categoryLocked: false,
        accountId: 'db-p-acc-new',
        descriptionLocked: true,
      },
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const call = prismaMock.transaction.upsert.mock.calls[0][0]
    expect(call.update).not.toHaveProperty('description')
    expect(call.update).not.toHaveProperty('descriptionKey')
    expect(call.update).toMatchObject({
      amountCents: -4290,
      category: 'Delivery',
      originalDescription: 'IFOOD *RESTAURANTE',
    })
  })

  it('descrição travada não esconde o pagamento de fatura do pareamento', async () => {
    pairingRows = [
      row({
        id: 'bill-pay',
        amountCents: -80000,
        description: 'paguei a fatura',
        originalDescription: 'PAGAMENTO FATURA',
      }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const pairingQuery = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => isPairingQuery(args.where),
    )?.[0]
    expect(pairingQuery.select.originalDescription).toBe(true)
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'bill-pay' },
      data: { isTransfer: true },
    })
  })

  it('transação nova casa com lançamento do WhatsApp e herda a descrição', async () => {
    manualRows = [manual({ id: 'manual-1', amountCents: -4500, description: 'Almoço', whatsappMessageId: 'wamid.1' })]
    const client = makeClient({
      listTransactions: vi.fn(async () => [
        pluggyTx({ date: TODAY, description: 'PIX ENVIADO RESTAURANTE X', amount: 45 }),
      ]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    const manualQuery = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => args.where.whatsappMessageId,
    )?.[0]
    expect(manualQuery.where).toEqual({
      userId: USER,
      accountId: 'db-p-acc-new',
      source: 'MANUAL',
      whatsappMessageId: { not: null },
    })
    expect(prismaMock.transaction.delete).toHaveBeenCalledWith({ where: { id: 'manual-1' } })
    expect(prismaMock.transaction.upsert).not.toHaveBeenCalled()
    expect(prismaMock.transaction.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      accountId: 'db-p-acc-new',
      pluggyTransactionId: 'p-tx-1',
      source: 'PLUGGY',
      amountCents: -4500,
      description: 'Almoço',
      descriptionKey: 'almoco',
      descriptionLocked: true,
      whatsappMessageId: 'wamid.1',
      originalDescription: 'PIX ENVIADO RESTAURANTE X',
      category: 'Delivery',
    })
    expect(prismaMock.transaction.create.mock.calls[0][0].data).not.toHaveProperty('categoryLocked')
    // Apaga antes de criar: `whatsappMessageId` é único.
    expect(prismaMock.transaction.delete.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.transaction.create.mock.invocationCallOrder[0],
    )
  })

  it('lançamento com categoria travada passa a categoria para a transação da Pluggy', async () => {
    manualRows = [manual({ category: 'Lazer', categoryLocked: true })]
    const client = makeClient({
      listTransactions: vi.fn(async () => [pluggyTx({ date: TODAY, amount: 45 })]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({
      category: 'Lazer',
      categoryLocked: true,
    })
  })

  it('a marca na mão do lançamento passa para a transação da Pluggy', async () => {
    manualRows = [manual({ necessity: 'AVOIDABLE' })]
    const client = makeClient({
      listTransactions: vi.fn(async () => [pluggyTx({ date: TODAY, amount: 45 })]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({ necessity: 'AVOIDABLE' })
  })

  it('o recorrente vinculado ao lançamento passa para a transação da Pluggy', async () => {
    manualRows = [manual({ recurrenceId: 'rec-1' })]
    const client = makeClient({
      listTransactions: vi.fn(async () => [pluggyTx({ date: TODAY, amount: 45 })]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({ recurrenceId: 'rec-1' })
  })

  it('dois lançamentos iguais casam com duas transações diferentes', async () => {
    manualRows = [
      manual({ id: 'manual-1', amountCents: -800, whatsappMessageId: 'wamid.1' }),
      manual({ id: 'manual-2', amountCents: -800, whatsappMessageId: 'wamid.2' }),
    ]
    const client = makeClient({
      listTransactions: vi.fn(async () => [
        pluggyTx({ id: 'p-tx-1', date: TODAY, amount: 8 }),
        pluggyTx({ id: 'p-tx-2', date: TODAY, amount: 8 }),
      ]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    const deleted = prismaMock.transaction.delete.mock.calls.map(([args]) => args.where.id)
    expect(deleted).toHaveLength(2)
    expect(new Set(deleted)).toEqual(new Set(['manual-1', 'manual-2']))
    const wamids = prismaMock.transaction.create.mock.calls.map(([args]) => args.data.whatsappMessageId)
    expect(new Set(wamids)).toEqual(new Set(['wamid.1', 'wamid.2']))
  })

  it('transação que já existe não casa com lançamento do WhatsApp', async () => {
    existingTxs = [
      { pluggyTransactionId: 'p-tx-1', userId: USER, categoryLocked: false, accountId: 'db-p-acc-new' },
    ]
    manualRows = [manual({ amountCents: -4290, date: new Date('2026-10-10T00:00:00Z') })]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.delete).not.toHaveBeenCalled()
    expect(prismaMock.transaction.upsert).toHaveBeenCalledTimes(1)
  })

  it('transação sem lançamento parecido segue o upsert normal', async () => {
    manualRows = [manual({ amountCents: -4291 })]
    const client = makeClient({
      listTransactions: vi.fn(async () => [pluggyTx({ date: TODAY, amount: 45 })]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.transaction.delete).not.toHaveBeenCalled()
    expect(prismaMock.transaction.upsert).toHaveBeenCalledTimes(1)
  })

  it('manuais do WhatsApp são lidos depois de apagar o que sumiu da Pluggy', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const calls = prismaMock.transaction.findMany.mock.calls
    const removedIndex = calls.findIndex(([args]) => args.where.pluggyTransactionId?.notIn)
    const manualIndex = calls.findIndex(([args]) => args.where.whatsappMessageId)
    expect(removedIndex).toBeGreaterThanOrEqual(0)
    expect(manualIndex).toBeGreaterThan(removedIndex)
  })

  it('manual do WhatsApp fica fora do pareamento', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const pairingQuery = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => isPairingQuery(args.where),
    )?.[0]
    expect(pairingQuery.where.NOT).toEqual({ source: 'MANUAL', whatsappMessageId: { not: null } })
  })

  it('faz upsert das faturas do cartão', async () => {
    const card: PluggyAccount = {
      id: 'p-card',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Cartão',
      balance: 800,
    }
    const client = makeClient({
      listAccounts: vi.fn(async () => [bankAccount, card]),
      listBills: vi.fn(async () => [
        {
          id: 'bill-1',
          dueDate: '2026-10-05T00:00:00.000Z',
          totalAmount: 812.34,
          payments: [{ amount: 500 }, { amount: 12.34 }],
        },
      ]),
    })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(client.listBills).toHaveBeenCalledTimes(1)
    expect(client.listBills).toHaveBeenCalledWith('p-card')
    const call = prismaMock.cardBill.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ pluggyBillId: 'bill-1', userId: USER })
    expect(call.create).toMatchObject({
      userId: USER,
      accountId: 'db-p-card',
      dueDate: new Date('2026-10-05T00:00:00Z'),
      totalCents: 81234,
      paidCents: 51234,
    })
  })

  it('na primeira sincronização pareia o ano inteiro buscado', async () => {
    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const pairingQuery = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => isPairingQuery(args.where),
    )?.[0]
    expect(pairingQuery.where.date).toEqual({ gte: new Date('2025-10-22T00:00:00Z') })
  })

  it('pareia transferências dos últimos 90 dias nos dois lados', async () => {
    prismaMock.connection.findUnique.mockResolvedValue({
      ...connection,
      lastSyncedAt: new Date('2026-10-20T15:00:00Z'),
    })
    pairingRows = [
      row({ id: 'out', accountId: 'acc-a', amountCents: -50000, description: 'PIX ENVIADO' }),
      row({ id: 'in', accountId: 'acc-b', amountCents: 50000, description: 'PIX RECEBIDO' }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const pairingQuery = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => isPairingQuery(args.where),
    )?.[0]
    expect(pairingQuery.where).toMatchObject({
      userId: USER,
      date: { gte: new Date('2026-07-24T00:00:00Z') },
    })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'out' },
      data: { isTransfer: true, transferPairId: 'in' },
    })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'in' },
      data: { isTransfer: true, transferPairId: 'out' },
    })
  })

  it('pagamento de fatura no banco sem par vira transferência sozinho', async () => {
    pairingRows = [row({ id: 'bill-pay', amountCents: -80000, description: 'PAGTO FATURA NUBANK' })]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'bill-pay' },
      data: { isTransfer: true },
    })
  })

  it('saque cria a transação SYSTEM na Carteira, pareada, e recalcula o saldo', async () => {
    pairingRows = [row({ id: 'saque', amountCents: -20000, description: 'SAQUE 24H' })]
    prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amountCents: 20000 } })

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.transaction.create.mock.calls[0][0].data).toMatchObject({
      userId: USER,
      accountId: 'wallet-1',
      date: new Date('2026-10-10T00:00:00Z'),
      description: 'SAQUE 24H',
      amountCents: 20000,
      source: 'SYSTEM',
      status: 'POSTED',
      isTransfer: true,
      transferPairId: 'saque',
    })
    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'saque' },
      data: { isTransfer: true, transferPairId: 'system-1' },
    })
    expect(prismaMock.account.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { balanceCents: 20000 },
    })
  })

  it('não cria crédito na Carteira de novo para um saque já pareado', async () => {
    pairingRows = [
      row({
        id: 'saque',
        amountCents: -20000,
        description: 'SAQUE 24H',
        isTransfer: true,
        transferPairOf: { id: 'system-1' },
      }),
      // Par gravado mesmo sem `isTransfer`: também não gera outro crédito.
      row({
        id: 'saque-2',
        amountCents: -20000,
        description: 'SAQUE 24H',
        transferPairOf: { id: 'system-2' },
      }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
    expect(prismaMock.transaction.update).not.toHaveBeenCalled()
  })

  it('mesmo pluggyAccountId vindo de outra conexão aponta a conta para esta', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      { id: 'db-p-acc-new', pluggyAccountId: 'p-acc-new', userId: USER, dueDay: null, closingDay: null },
    ])

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.account.upsert.mock.calls[0][0].update.connectionId).toBe('conn-1')
  })

  it('não funde conta nenhuma quando nenhuma transação mudou de conta', async () => {
    existingTxs = [
      { pluggyTransactionId: 'p-tx-1', userId: USER, categoryLocked: false, accountId: 'db-p-acc-new' },
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.account.delete).not.toHaveBeenCalled()
    expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled()
  })

  it('apaga as transações da conta que sumiram da Pluggy depois do dia de corte', async () => {
    removedRows = [{ id: 'gone', transferPair: null, transferPairOf: null }]
    prismaMock.connection.findUnique.mockResolvedValue({
      ...connection,
      lastSyncedAt: new Date('2026-10-20T15:00:00Z'),
    })

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    const query = prismaMock.transaction.findMany.mock.calls.find(
      ([args]) => args.where.pluggyTransactionId?.notIn,
    )?.[0]
    expect(query.where).toEqual({
      userId: USER,
      accountId: 'db-p-acc-new',
      source: 'PLUGGY',
      date: { gt: new Date('2026-09-20T00:00:00Z') },
      pluggyTransactionId: { notIn: ['p-tx-1'] },
    })
    expect(prismaMock.transaction.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['gone'] } },
    })
  })

  it('lista vazia da Pluggy não apaga nada', async () => {
    const client = makeClient({ listTransactions: vi.fn(async () => []) })

    await syncConnection('conn-1', { client, today: TODAY })

    expect(prismaMock.transaction.deleteMany).not.toHaveBeenCalled()
  })

  it('entrada no cartão "PAGAMENTO RECEBIDO" sem par vira transferência sozinha', async () => {
    pairingRows = [
      row({
        id: 'card-pay',
        amountCents: 80000,
        description: 'PAGAMENTO RECEBIDO',
        account: { type: 'CREDIT' },
      }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'card-pay' },
      data: { isTransfer: true },
    })
  })

  it('entrada de pagamento de fatura no cartão sem par vira transferência sozinha', async () => {
    pairingRows = [
      row({
        id: 'card-pay',
        amountCents: 80000,
        description: 'Pagamento de fatura',
        account: { type: 'CREDIT' },
      }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.update).toHaveBeenCalledWith({
      where: { id: 'card-pay' },
      data: { isTransfer: true },
    })
  })

  it('saque em conta CREDIT não cria crédito na Carteira', async () => {
    pairingRows = [
      row({ id: 'saque-card', amountCents: -20000, description: 'SAQUE', account: { type: 'CREDIT' } }),
    ]

    await syncConnection('conn-1', { client: makeClient(), today: TODAY })

    expect(prismaMock.transaction.create).not.toHaveBeenCalled()
  })

  it('duas sincronizações do mesmo usuário rodam uma depois da outra', async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    const client = makeClient({
      getItem: vi.fn(async () => {
        const n = ++calls
        events.push(`start-${n}`)
        if (n === 1) await firstGate
        return item
      }),
      listBills: vi.fn(async () => []),
    })
    prismaMock.connection.update.mockImplementation(async ({ data }) => {
      if (data.lastSyncedAt) events.push(`end-${calls}`)
      return {}
    })

    const first = syncConnection('conn-1', { client, today: TODAY })
    const second = syncConnection('conn-1', { client, today: TODAY })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(events).toEqual(['start-1'])

    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('a fila continua depois de uma sincronização que falhou', async () => {
    const failing = makeClient({
      getItem: vi.fn(async () => {
        throw new Error('fora do ar')
      }),
    })
    const ok = makeClient()

    const first = syncConnection('conn-1', { client: failing, today: TODAY })
    const second = syncConnection('conn-1', { client: ok, today: TODAY })

    await expect(first).rejects.toThrow('fora do ar')
    await expect(second).resolves.toBeUndefined()
    expect(ok.getItem).toHaveBeenCalled()
  })

  it('erro da Pluggy grava lastError e relança', async () => {
    const client = makeClient({
      listTransactions: vi.fn(async () => {
        throw new Error('Pluggy 500: boom')
      }),
    })

    await expect(syncConnection('conn-1', { client, today: TODAY })).rejects.toThrow('boom')

    expect(prismaMock.connection.update).toHaveBeenLastCalledWith({
      where: { id: 'conn-1' },
      data: { lastError: 'Pluggy 500: boom' },
    })
  })
})

type ManualRow = {
  id: string
  accountId: string
  amountCents: number
  date: Date
  createdAt: Date
  description: string
  descriptionKey: string
  whatsappMessageId: string
  category: string | null
  categoryLocked: boolean
  necessity: string | null
  recurrenceId: string | null
}

function manual(extra: Partial<ManualRow>): ManualRow {
  return {
    id: 'manual-1',
    accountId: 'db-p-acc-new',
    amountCents: -4500,
    date: new Date(`${TODAY}T00:00:00Z`),
    createdAt: new Date('2026-10-22T15:00:00Z'),
    description: 'Almoço',
    descriptionKey: 'almoco',
    whatsappMessageId: 'wamid.1',
    category: null,
    categoryLocked: false,
    necessity: null,
    recurrenceId: null,
    ...extra,
  }
}

/** A leitura do pareamento: a única com janela de data e sem filtro por id. */
function isPairingQuery(where: Record<string, unknown>): boolean {
  return !where.pluggyTransactionId && !where.whatsappMessageId
}

function row(extra: Partial<PairingRow>): PairingRow {
  return {
    id: 'tx',
    accountId: 'acc-a',
    date: new Date('2026-10-10T00:00:00Z'),
    description: 'x',
    amountCents: -100,
    isTransfer: false,
    transferLocked: false,
    transferPairId: null,
    transferPairOf: null,
    account: { type: 'BANK' },
    ...extra,
  }
}
