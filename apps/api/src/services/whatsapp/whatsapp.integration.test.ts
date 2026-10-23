import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Interpretation } from '@/lib/gemini/interpret-entry'
import type { PluggyClient } from '@/lib/pluggy/client'
import type { PluggyAccount, PluggyTransaction } from '@/lib/pluggy/types'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import { syncConnection } from '@/services/sync-connection'
import { ensureWalletAccount } from '@/services/wallet'

import { resetConversation } from './conversation'
import { handleWhatsappMessage } from './handle-message'

const EMAIL_DOMAIN = '@whatsapp.integration.test'
const TODAY = todayIso()

let run: string
let userId: string
let phone: string
let connectionId: string
let bankId: string

const pid = (name: string) => `${run}-${name}`

const bankAccount: () => PluggyAccount = () => ({
  id: pid('bank'),
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: 'Nubank',
  balance: 100,
})

function remoteTx(
  name: string,
  amount: number,
  description: string,
  status: 'POSTED' | 'PENDING' = 'POSTED',
): PluggyTransaction {
  return {
    id: pid(name),
    accountId: '',
    date: `${TODAY}T00:00:00.000Z`,
    description,
    amount: Math.abs(amount),
    type: amount < 0 ? 'DEBIT' : 'CREDIT',
    status,
    category: null,
    creditCardMetadata: null,
  }
}

function fakePluggy(txs: PluggyTransaction[]): PluggyClient {
  return {
    getItem: vi.fn(async (id: string) => ({ id, status: 'UPDATED', connector: { name: 'Banco' }, error: null })),
    listAccounts: vi.fn(async () => [bankAccount()]),
    listTransactions: vi.fn(async () => txs),
    listBills: vi.fn(async () => []),
    registerWebhook: vi.fn(async () => undefined),
    createConnectToken: vi.fn(async () => 'connect-token'),
  }
}

const sync = (txs: PluggyTransaction[]) =>
  syncConnection(connectionId, { client: fakePluggy(txs), today: TODAY })

const sendText = vi.fn(async () => undefined)
const client = { sendText, downloadMedia: vi.fn() }

function say(text: string, id: string, interpretation?: Interpretation) {
  return handleWhatsappMessage(
    { id: `${run}-${id}`, from: phone, text },
    { client, interpret: vi.fn(async () => interpretation as Interpretation), today: TODAY },
  )
}

const entryFor = (accountId: string, amountCents = -4500): Interpretation => ({
  kind: 'entry',
  draft: { description: 'Almoço', amountCents, date: TODAY, category: null },
  accountId,
})

const accountTxs = (accountId: string) => prisma.transaction.findMany({ where: { accountId } })

async function cleanUp() {
  await prisma.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } })
}

beforeEach(async () => {
  await cleanUp()
  resetConversation()
  sendText.mockClear()
  run = randomUUID().slice(0, 8)
  // Número no formato da Meta (sem o 9); o cadastro tem o 9: cobre as duas formas.
  const digits = String(Math.floor(Math.random() * 1e8)).padStart(8, '1')
  phone = `5511${digits}`
  const user = await prisma.user.create({
    data: {
      name: 'Zap',
      email: `${run}${EMAIL_DOMAIN}`,
      passwordHash: 'x',
      whatsappPhone: `55119${digits}`,
    },
  })
  userId = user.id
  connectionId = (
    await prisma.connection.create({
      data: { userId, pluggyItemId: pid('item'), connectorName: 'Banco', status: 'UPDATED' },
    })
  ).id
  bankId = (
    await prisma.account.create({
      data: {
        userId,
        connectionId,
        pluggyAccountId: pid('bank'),
        type: 'BANK',
        name: 'Nubank',
        balanceCents: 10_000,
      },
    })
  ).id
})

afterAll(cleanUp)

describe('lançamento do WhatsApp ponta a ponta', () => {
  it('WhatsApp antes da Pluggy: fica uma transação só, com a descrição do João', async () => {
    await say('almoço 45 pix nubank', 'm1', entryFor(bankId))
    expect(await accountTxs(bankId)).toMatchObject([{ source: 'MANUAL', description: 'Almoço' }])

    await sync([remoteTx('t1', -45, 'PIX ENVIADO RESTAURANTE')])
    const rows = await accountTxs(bankId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      source: 'PLUGGY',
      pluggyTransactionId: pid('t1'),
      description: 'Almoço',
    })

    await sync([remoteTx('t1', -45, 'PIX RESTAURANTE LTDA')])
    const again = await accountTxs(bankId)
    expect(again).toHaveLength(1)
    expect(again[0].description).toBe('Almoço')
  })

  it('Pluggy antes do WhatsApp: renomeia e desfazer restaura o texto do banco', async () => {
    await sync([remoteTx('t1', -45, 'PIX RESTAURANTE')])
    await say('almoço 45 pix nubank', 'm1', entryFor(bankId))

    const [renamed] = await accountTxs(bankId)
    expect(await accountTxs(bankId)).toHaveLength(1)
    expect(renamed).toMatchObject({
      description: 'Almoço',
      originalDescription: 'PIX RESTAURANTE',
      descriptionLocked: true,
    })

    await say('desfazer', 'm2')
    const [restored] = await accountTxs(bankId)
    expect(restored).toMatchObject({
      description: 'PIX RESTAURANTE',
      descriptionLocked: false,
      originalDescription: null,
    })
  })

  it('pendente vira lançada com outro id: a descrição passa adiante', async () => {
    await say('almoço 45 pix nubank', 'm1', entryFor(bankId))
    await sync([remoteTx('p1', -45, 'PIX RESTAURANTE', 'PENDING')])
    const [matched] = await accountTxs(bankId)
    expect(matched).toMatchObject({ pluggyTransactionId: pid('p1'), description: 'Almoço' })

    await sync([remoteTx('p2', -45, 'PIX RESTAURANTE')])
    const rows = await accountTxs(bankId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ pluggyTransactionId: pid('p2'), description: 'Almoço' })
  })

  it('Carteira: dinheiro recalcula o saldo', async () => {
    const wallet = await ensureWalletAccount(userId)
    await say('almoço 45 dinheiro', 'm1', entryFor(wallet.id))
    expect((await prisma.account.findUniqueOrThrow({ where: { id: wallet.id } })).balanceCents).toBe(-4500)

    await say('desfazer', 'm2')
    expect(await accountTxs(wallet.id)).toHaveLength(0)
    expect((await prisma.account.findUniqueOrThrow({ where: { id: wallet.id } })).balanceCents).toBe(0)
  })
})
