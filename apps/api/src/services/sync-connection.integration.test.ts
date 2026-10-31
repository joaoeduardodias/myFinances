import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { processPluggyEvent } from '@/http/routes/webhooks/pluggy-webhook'
import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { computeCardBills } from '@/lib/finance/card-bills'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyAccount, PluggyTransaction } from '@/lib/pluggy/types'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'

import { syncConnection } from './sync-connection'

const EMAIL_DOMAIN = '@sync.integration.test'
const TODAY = todayIso()

let run: string
let userId: string

/** Ids da Pluggy são únicos no banco inteiro: cada teste usa um prefixo próprio. */
const pid = (name: string) => `${run}-${name}`

function account(name: string, type: 'BANK' | 'CREDIT'): PluggyAccount {
  return { id: pid(name), type, subtype: type === 'BANK' ? 'CHECKING_ACCOUNT' : 'CREDIT_CARD', name, balance: 100 }
}

function remoteTx(
  name: string,
  daysAgo: number,
  amount: number,
  description: string,
  extra: Partial<PluggyTransaction> = {},
): PluggyTransaction {
  return {
    id: pid(name),
    accountId: '',
    date: `${addDays(TODAY, -daysAgo)}T00:00:00.000Z`,
    description,
    amount: Math.abs(amount),
    type: amount < 0 ? 'DEBIT' : 'CREDIT',
    status: 'POSTED',
    category: null,
    creditCardMetadata: null,
    ...extra,
  }
}

/** Pluggy de mentira: o que cada conta devolve pode mudar entre uma sincronização e outra. */
function fakeClient(accounts: PluggyAccount[], txs: Record<string, PluggyTransaction[]>): PluggyClient {
  return {
    getItem: vi.fn(async (id: string) => ({ id, status: 'UPDATED', connector: { name: 'Banco' }, error: null })),
    listAccounts: vi.fn(async () => accounts),
    listTransactions: vi.fn(async (accountId: string) => txs[accountId] ?? []),
    listBills: vi.fn(async () => []),
    registerWebhook: vi.fn(async () => undefined),
    createConnectToken: vi.fn(async () => 'connect-token'),
  }
}

async function createConnection() {
  const connection = await prisma.connection.create({
    data: { userId, pluggyItemId: pid(`item-${randomUUID()}`), connectorName: 'Banco', status: 'UPDATED' },
  })
  return connection.id
}

async function txByPluggyId(name: string) {
  return prisma.transaction.findUnique({ where: { pluggyTransactionId: pid(name) } })
}

async function cleanUp() {
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } })
}

beforeEach(async () => {
  await cleanUp()
  run = randomUUID().slice(0, 8)
  const user = await prisma.user.create({
    data: { name: 'Sync', email: `${run}${EMAIL_DOMAIN}`, passwordHash: 'x' },
  })
  userId = user.id
})

afterAll(cleanUp)

describe('renovação do Meu Pluggy', () => {
  async function seedOldConnection() {
    const oldConnectionId = await createConnection()
    const oldBank = await prisma.account.create({
      data: {
        userId,
        connectionId: oldConnectionId,
        pluggyAccountId: pid('old-bank'),
        type: 'BANK',
        name: 'Conta',
        balanceCents: 100_000,
      },
    })
    const oldCard = await prisma.account.create({
      data: {
        userId,
        connectionId: oldConnectionId,
        pluggyAccountId: pid('old-card'),
        type: 'CREDIT',
        name: 'Cartão',
        balanceCents: 50_000,
        closingDay: 3,
        dueDay: 10,
      },
    })
    const base = { userId, status: 'POSTED' as const, source: 'PLUGGY' as const }
    await prisma.transaction.createMany({
      data: [
        {
          ...base,
          accountId: oldBank.id,
          pluggyTransactionId: pid('salary'),
          date: toDbDate(addDays(TODAY, -20)),
          description: 'SALARIO',
          descriptionKey: 'salario',
          amountCents: 500_000,
        },
        // Mais velha que o ano que a Pluggy devolve: só existe na conta antiga.
        {
          ...base,
          accountId: oldBank.id,
          pluggyTransactionId: pid('ancient'),
          date: toDbDate(addDays(TODAY, -400)),
          description: 'SALARIO',
          descriptionKey: 'salario',
          amountCents: 480_000,
        },
        {
          ...base,
          accountId: oldCard.id,
          pluggyTransactionId: pid('card-buy'),
          date: toDbDate(addDays(TODAY, -15)),
          description: 'MERCADO',
          descriptionKey: 'mercado',
          amountCents: -10_000,
        },
      ],
    })
    const recurrence = {
      userId,
      accountId: oldBank.id,
      expectedAmountCents: 500_000,
      dayRule: 'NTH_BUSINESS_DAY' as const,
      dayValue: 5,
    }
    await prisma.recurrence.createMany({
      data: [
        { ...recurrence, description: 'SALARIO', descriptionKey: 'salario', direction: 'IN', status: 'CONFIRMED' },
        { ...recurrence, description: 'ACADEMIA', descriptionKey: 'academia', direction: 'OUT', status: 'DISMISSED' },
        { ...recurrence, description: 'ALUGUEL', descriptionKey: 'aluguel', direction: 'OUT', status: 'SUGGESTED' },
      ],
    })
    return { oldBank, oldCard }
  }

  const newClient = () =>
    fakeClient([account('new-bank', 'BANK'), account('new-card', 'CREDIT')], {
      [pid('new-bank')]: [remoteTx('salary', 20, 5000, 'SALARIO')],
      [pid('new-card')]: [remoteTx('card-buy', 15, -100, 'MERCADO')],
    })

  it('passa transações, recorrentes e ciclo do cartão para a conta nova e apaga a antiga', async () => {
    const { oldBank, oldCard } = await seedOldConnection()
    const newConnectionId = await createConnection()

    await syncConnection(newConnectionId, { client: newClient(), today: TODAY })

    const accounts = await prisma.account.findMany({ where: { userId, type: { not: 'WALLET' } } })
    expect(accounts.map((a) => a.pluggyAccountId).sort()).toEqual([pid('new-bank'), pid('new-card')].sort())
    expect(accounts.find((a) => a.id === oldBank.id || a.id === oldCard.id)).toBeUndefined()

    const newBank = accounts.find((a) => a.type === 'BANK')!
    const newCard = accounts.find((a) => a.type === 'CREDIT')!
    // O histórico que a Pluggy não devolve mais também veio: nada some, nada conta duas vezes.
    expect((await txByPluggyId('ancient'))?.accountId).toBe(newBank.id)
    expect((await txByPluggyId('salary'))?.accountId).toBe(newBank.id)
    expect(newCard).toMatchObject({ closingDay: 3, dueDay: 10 })

    const recurrences = await prisma.recurrence.findMany({ where: { userId }, orderBy: { descriptionKey: 'asc' } })
    expect(recurrences.map((r) => [r.descriptionKey, r.status, r.accountId])).toEqual([
      ['academia', 'DISMISSED', newBank.id],
      ['aluguel', 'SUGGESTED', newBank.id],
      ['salario', 'CONFIRMED', newBank.id],
    ])
  })

  it('na colisão de recorrente fica a confirmada, depois a descartada, depois a sugerida', async () => {
    await seedOldConnection()
    const newConnectionId = await createConnection()
    // A conta nova já existe com sugestões próprias (sincronização anterior da conexão nova).
    const newBank = await prisma.account.create({
      data: {
        userId,
        connectionId: newConnectionId,
        pluggyAccountId: pid('new-bank'),
        type: 'BANK',
        name: 'Conta',
        balanceCents: 0,
      },
    })
    const recurrence = {
      userId,
      accountId: newBank.id,
      expectedAmountCents: 500_000,
      dayRule: 'DAY_OF_MONTH' as const,
      dayValue: 5,
    }
    await prisma.recurrence.createMany({
      data: [
        { ...recurrence, description: 'SALARIO', descriptionKey: 'salario', direction: 'IN', status: 'SUGGESTED' },
        { ...recurrence, description: 'ACADEMIA', descriptionKey: 'academia', direction: 'OUT', status: 'SUGGESTED' },
        { ...recurrence, description: 'ALUGUEL', descriptionKey: 'aluguel', direction: 'OUT', status: 'CONFIRMED' },
      ],
    })
    // Vínculo na que vai perder a colisão: passa para a que fica.
    const losing = await prisma.recurrence.findFirstOrThrow({
      where: { userId, accountId: newBank.id, descriptionKey: 'salario' },
    })
    await prisma.transaction.updateMany({
      where: { userId, pluggyTransactionId: pid('salary') },
      data: { recurrenceId: losing.id },
    })

    await syncConnection(newConnectionId, { client: newClient(), today: TODAY })

    const salary = await prisma.recurrence.findFirstOrThrow({ where: { userId, descriptionKey: 'salario' } })
    expect((await txByPluggyId('salary'))?.recurrenceId).toBe(salary.id)

    const recurrences = await prisma.recurrence.findMany({ where: { userId }, orderBy: { descriptionKey: 'asc' } })
    expect(recurrences.map((r) => [r.descriptionKey, r.status, r.dayRule])).toEqual([
      ['academia', 'DISMISSED', 'NTH_BUSINESS_DAY'],
      ['aluguel', 'CONFIRMED', 'DAY_OF_MONTH'],
      ['salario', 'CONFIRMED', 'NTH_BUSINESS_DAY'],
    ])
    expect(new Set(recurrences.map((r) => r.accountId))).toEqual(new Set([newBank.id]))
  })
})

describe('pagamento de fatura em sincronizações diferentes', () => {
  it('a saída do banco marcada sozinha pareia depois com a entrada no cartão, e a fatura não diminui', async () => {
    const connectionId = await createConnection()
    const accounts = [account('bank', 'BANK'), account('card', 'CREDIT')]
    const bankTxs = [remoteTx('bill-pay', 5, -800, 'PAGTO FATURA CARTAO')]
    const cardTxs = [remoteTx('buy', 20, -800, 'LOJA')]

    await syncConnection(connectionId, {
      client: fakeClient(accounts, { [pid('bank')]: bankTxs, [pid('card')]: cardTxs }),
      today: TODAY,
    })
    const bankSide = await txByPluggyId('bill-pay')
    expect(bankSide).toMatchObject({ isTransfer: true, transferPairId: null })

    // O cartão só mostra o pagamento na sincronização seguinte.
    await syncConnection(connectionId, {
      client: fakeClient(accounts, {
        [pid('bank')]: bankTxs,
        [pid('card')]: [...cardTxs, remoteTx('card-credit', 4, 800, 'PAGAMENTO RECEBIDO')],
      }),
      today: TODAY,
    })

    const cardSide = await txByPluggyId('card-credit')
    const pairedBankSide = await txByPluggyId('bill-pay')
    expect(cardSide?.isTransfer).toBe(true)
    expect(pairedBankSide?.transferPairId).toBe(cardSide?.id)
    expect(cardSide?.transferPairId).toBe(pairedBankSide?.id)

    const card = await prisma.account.findUniqueOrThrow({ where: { pluggyAccountId: pid('card') } })
    const cardRows = await prisma.transaction.findMany({ where: { accountId: card.id } })
    const bills = computeCardBills({
      accountId: card.id,
      closingDay: 1,
      dueDay: 10,
      transactions: cardRows.map((t) => ({ ...t, date: fromDbDate(t.date) })),
      pluggyBills: [],
      today: TODAY,
    })
    const billWithPurchase = bills.find((b) => b.transactions.some((t) => t.description === 'LOJA'))
    expect(billWithPurchase?.amountCents).toBe(80_000)
    expect(bills.some((b) => b.transactions.some((t) => t.description === 'PAGAMENTO RECEBIDO'))).toBe(false)
  })
})

describe('transação que sumiu da Pluggy', () => {
  // Funções: os ids dependem do prefixo do teste, que só existe no `beforeEach`.
  const accounts = () => [account('bank', 'BANK'), account('bank-2', 'BANK')]
  const firstSync = () => ({
    bank: [
      remoteTx('pending', 5, -50, 'MERCADO', { status: 'PENDING' }),
      remoteTx('saque', 4, -200, 'SAQUE 24H'),
      remoteTx('pix-out', 3, -300, 'PIX ENVIADO'),
      remoteTx('pix-locked-out', 3, -70, 'PIX ENVIADO'),
    ],
    bank2: [remoteTx('pix-in', 3, 300, 'PIX RECEBIDO'), remoteTx('pix-locked-in', 3, 70, 'PIX RECEBIDO')],
  })

  async function syncFirst() {
    const connectionId = await createConnection()
    await syncConnection(connectionId, {
      client: fakeClient(accounts(), { [pid('bank')]: firstSync().bank, [pid('bank-2')]: firstSync().bank2 }),
      today: TODAY,
    })
    const wallet = await prisma.account.findFirstOrThrow({ where: { userId, type: 'WALLET' } })
    expect(wallet.balanceCents).toBe(20_000)
    expect((await txByPluggyId('pix-in'))?.isTransfer).toBe(true)
    // O usuário confirmou este par: a marca dele não pode cair.
    await prisma.transaction.update({
      where: { pluggyTransactionId: pid('pix-locked-in') },
      data: { transferLocked: true },
    })
    return { connectionId, walletId: wallet.id }
  }

  it('na sincronização sai do banco, desfaz o par e apaga o crédito do saque na Carteira', async () => {
    const { connectionId, walletId } = await syncFirst()

    await syncConnection(connectionId, {
      client: fakeClient(accounts(), {
        // O pendente voltou com outro id; saque e PIX foram desfeitos pelo banco.
        [pid('bank')]: [remoteTx('posted', 5, -50, 'MERCADO')],
        [pid('bank-2')]: firstSync().bank2,
      }),
      today: TODAY,
    })

    for (const name of ['pending', 'saque', 'pix-out', 'pix-locked-out']) {
      expect(await txByPluggyId(name)).toBeNull()
    }
    expect(await txByPluggyId('posted')).not.toBeNull()
    expect(await prisma.transaction.count({ where: { accountId: walletId } })).toBe(0)
    expect((await prisma.account.findUniqueOrThrow({ where: { id: walletId } })).balanceCents).toBe(0)
    expect(await txByPluggyId('pix-in')).toMatchObject({ isTransfer: false, transferPairId: null })
    expect(await txByPluggyId('pix-locked-in')).toMatchObject({ isTransfer: true, transferPairId: null })
  })

  it('o webhook transactions/deleted faz a mesma limpeza', async () => {
    const { walletId } = await syncFirst()

    await processPluggyEvent(
      { event: 'transactions/deleted', transactionIds: [pid('saque'), pid('pix-out')] },
      { error: vi.fn() },
    )

    expect(await txByPluggyId('saque')).toBeNull()
    expect(await txByPluggyId('pix-out')).toBeNull()
    expect(await prisma.transaction.count({ where: { accountId: walletId } })).toBe(0)
    expect((await prisma.account.findUniqueOrThrow({ where: { id: walletId } })).balanceCents).toBe(0)
    expect(await txByPluggyId('pix-in')).toMatchObject({ isTransfer: false, transferPairId: null })
  })
})
