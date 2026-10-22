import { env } from '@myfinances/env'

import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { mapPluggyCategory } from '@/lib/finance/categories'
import { descriptionKey } from '@/lib/finance/description-key'
import {
  detectTransferPairs,
  isBillPaymentDescription,
  isCardPaymentCreditDescription,
  isWithdrawalDescription,
} from '@/lib/finance/detect-transfers'
import { toCents } from '@/lib/finance/money'
import { pluggy, type PluggyClient } from '@/lib/pluggy/client'
import { itemErrorText } from '@/lib/pluggy/connection-error'
import type { PluggyAccount } from '@/lib/pluggy/types'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'

import { detectAndStoreRecurrences } from './detect-and-store-recurrences'
import { removeTransactions } from './remove-transactions'
import { ensureWalletAccount, recomputeWalletBalance } from './wallet'

const FIRST_SYNC_DAYS = 365
const RESYNC_OVERLAP_DAYS = 30
const TRANSFER_WINDOW_DAYS = 90
const CLOSING_DAYS_BEFORE_DUE = 7

type SyncedAccount = { id: string; pluggyAccountId: string; type: 'BANK' | 'CREDIT' }

function toCentsAbs(value: number): number {
  return Math.round(Math.abs(value) * 100)
}

/**
 * Data civil de um campo de data da Pluggy. Meia-noite UTC é a data civil
 * "pura" (cortar evita voltar um dia no fuso de São Paulo); com hora, é um
 * instante e vale o dia no fuso do usuário.
 */
function pluggyDate(value: string): IsoDate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /T00:00:00(\.0+)?Z$/.test(value)) {
    return value.slice(0, 10)
  }
  return todayIso(env.TIMEZONE, new Date(value))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Webhook e o botão Sincronizar podem disparar ao mesmo tempo para o mesmo
// usuário; em paralelo, os upserts colidem (P2002). A API roda numa instância
// só, então uma fila em memória por usuário basta.
const userQueues = new Map<string, Promise<void>>()

function runExclusive(userId: string, task: () => Promise<void>): Promise<void> {
  const previous = userQueues.get(userId) ?? Promise.resolve()
  const run = previous.then(task)
  const tail = run.catch(() => {})
  userQueues.set(userId, tail)
  tail.then(() => {
    if (userQueues.get(userId) === tail) userQueues.delete(userId)
  })
  return run
}

export async function syncConnection(
  connectionId: string,
  opts: { client?: PluggyClient; today?: IsoDate } = {},
): Promise<void> {
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } })
  if (!connection) throw new Error(`Conexão ${connectionId} não encontrada`)
  return runExclusive(connection.userId, () => runSync(connection, opts))
}

async function runSync(
  connection: { id: string; userId: string; pluggyItemId: string; lastSyncedAt: Date | null },
  opts: { client?: PluggyClient; today?: IsoDate },
): Promise<void> {
  const client = opts.client ?? pluggy
  const today = opts.today ?? todayIso()
  const { id: connectionId, userId } = connection

  try {
    const item = await client.getItem(connection.pluggyItemId)
    await prisma.connection.update({
      where: { id: connectionId },
      data: {
        status: item.status,
        connectorName: item.connector.name,
        consentExpiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt) : null,
        lastError: itemErrorText(item.error),
      },
    })

    const accounts = await syncAccounts(client, connection.pluggyItemId, connectionId, userId)

    const dateFrom = connection.lastSyncedAt
      ? addDays(todayIso(env.TIMEZONE, connection.lastSyncedAt), -RESYNC_OVERLAP_DAYS)
      : addDays(today, -FIRST_SYNC_DAYS)
    const renewed = await syncTransactions(client, accounts, userId, dateFrom)
    await mergeRenewedAccounts(renewed, userId, connectionId)
    await syncBills(client, accounts, userId)
    // Na primeira sincronização o ano inteiro é novo e precisa ser pareado.
    const transferWindowDays = connection.lastSyncedAt ? TRANSFER_WINDOW_DAYS : FIRST_SYNC_DAYS
    await pairTransfers(userId, today, transferWindowDays)
    // Depois do pareamento: transferência não vira recorrente.
    await detectAndStoreRecurrences(userId, today)

    await prisma.connection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date(), lastError: itemErrorText(item.error) },
    })
  } catch (error) {
    await prisma.connection
      .update({ where: { id: connectionId }, data: { lastError: errorMessage(error) } })
      .catch(() => {})
    throw error
  }
}

async function syncAccounts(
  client: PluggyClient,
  itemId: string,
  connectionId: string,
  userId: string,
): Promise<SyncedAccount[]> {
  const remote = await client.listAccounts(itemId)
  const existing = await prisma.account.findMany({
    where: { pluggyAccountId: { in: remote.map((a) => a.id) } },
    select: { pluggyAccountId: true, userId: true, dueDay: true, closingDay: true },
  })
  const existingById = new Map(existing.map((a) => [a.pluggyAccountId, a]))

  const synced: SyncedAccount[] = []
  for (const account of remote) {
    const current = existingById.get(account.id)
    // Uma conta da Pluggy pertence a um único usuário; nunca escrevemos na de outro.
    if (current && current.userId !== userId) continue

    const { dueDay, closingDay } = cardDays(account)
    const fields = {
      connectionId,
      type: account.type,
      name: account.name,
      number: account.number ?? null,
      // Em conta CREDIT, positivo é o valor devido no cartão (convenção da Pluggy).
      balanceCents: Math.round(account.balance * 100),
    }
    const saved = await prisma.account.upsert({
      where: { pluggyAccountId: account.id, userId },
      create: { ...fields, userId, pluggyAccountId: account.id, dueDay, closingDay },
      update: {
        ...fields,
        // O usuário pode ter corrigido os dias do cartão: só preenchemos os vazios.
        ...(current?.dueDay == null && dueDay != null ? { dueDay } : {}),
        ...(current?.closingDay == null && closingDay != null ? { closingDay } : {}),
      },
    })
    synced.push({ id: saved.id, pluggyAccountId: account.id, type: account.type })
  }
  return synced
}

function cardDays(account: PluggyAccount): { dueDay: number | null; closingDay: number | null } {
  const due = account.type === 'CREDIT' ? account.creditData?.balanceDueDate : undefined
  if (!due) return { dueDay: null, closingDay: null }
  const dueDate = pluggyDate(due)
  return {
    dueDay: Number(dueDate.slice(8, 10)),
    closingDay: Number(addDays(dueDate, -CLOSING_DAYS_BEFORE_DUE).slice(8, 10)),
  }
}

async function syncTransactions(
  client: PluggyClient,
  accounts: SyncedAccount[],
  userId: string,
  dateFrom: IsoDate,
): Promise<Map<string, string>> {
  // Conta antiga → conta nova, quando uma transação mudou de conta (item renovado).
  const renewed = new Map<string, string>()
  const rules = await prisma.categoryRule.findMany({
    where: { userId },
    select: { descriptionKey: true, category: true },
  })
  const ruleByKey = new Map(rules.map((r) => [r.descriptionKey, r.category]))

  for (const account of accounts) {
    const remote = await client.listTransactions(account.pluggyAccountId, dateFrom)
    // Lista vazia pode ser a Pluggy falhando calada; apagar o mês inteiro por
    // isso custaria categorias e marcas do usuário.
    if (remote.length === 0) continue

    // Sumiu da Pluggy (pendente que virou outra transação, estorno do banco):
    // sai daqui também, senão conta duas vezes. O dia do `dateFrom` fica de
    // fora: a data gravada é a do fuso do usuário e pode não bater com o
    // corte da Pluggy.
    await removeTransactions({
      userId,
      accountId: account.id,
      source: 'PLUGGY',
      date: { gt: toDbDate(dateFrom) },
      pluggyTransactionId: { notIn: remote.map((t) => t.id) },
    })

    // Ler antes para saber de quem é a linha e se a categoria está travada.
    const existing = await prisma.transaction.findMany({
      where: { pluggyTransactionId: { in: remote.map((t) => t.id) } },
      select: { pluggyTransactionId: true, userId: true, categoryLocked: true, accountId: true },
    })
    const existingById = new Map(existing.map((t) => [t.pluggyTransactionId, t]))

    for (const tx of remote) {
      const current = existingById.get(tx.id)
      if (current && current.userId !== userId) continue
      if (current && current.accountId !== account.id && !renewed.has(current.accountId)) {
        renewed.set(current.accountId, account.id)
      }

      const key = descriptionKey(tx.description)
      // Chave vazia (descrição só de dígitos/prefixo) não casa com regra.
      const category = (key && ruleByKey.get(key)) || mapPluggyCategory(tx.category)
      const fields = {
        // Um item renovado traz contas novas com as mesmas transações.
        accountId: account.id,
        date: toDbDate(pluggyDate(tx.date)),
        description: tx.description,
        descriptionKey: key,
        amountCents: toCents(tx.amount, tx.type),
        status: tx.status,
        pluggyCategory: tx.category ?? null,
        installmentNumber: tx.creditCardMetadata?.installmentNumber ?? null,
        totalInstallments: tx.creditCardMetadata?.totalInstallments ?? null,
      }
      await prisma.transaction.upsert({
        where: { pluggyTransactionId: tx.id, userId },
        create: { ...fields, userId, pluggyTransactionId: tx.id, source: 'PLUGGY', category },
        update: { ...fields, ...(current?.categoryLocked ? {} : { category }) },
      })
    }
  }
  return renewed
}

const RECURRENCE_STATUS_RANK = { CONFIRMED: 2, DISMISSED: 1, SUGGESTED: 0 } as const

/**
 * Renovar o Meu Pluggy cria um item (e uma Connection) novo, com contas novas
 * que trazem as mesmas transações. A conta antiga, de outra conexão, passa
 * tudo para a nova — inclusive o histórico que a Pluggy já não devolve, as
 * recorrentes confirmadas/descartadas e os dias do cartão — e é apagada, para
 * o saldo não contar duas vezes.
 */
async function mergeRenewedAccounts(
  renewed: Map<string, string>,
  userId: string,
  connectionId: string,
) {
  const recurrenceSelect = {
    select: { id: true, descriptionKey: true, direction: true, status: true },
  } as const
  for (const [oldId, newId] of renewed) {
    const old = await prisma.account.findFirst({
      where: { id: oldId, userId, connectionId: { not: connectionId }, type: { not: 'WALLET' } },
      select: { closingDay: true, dueDay: true, recurrences: recurrenceSelect },
    })
    if (!old) continue
    const target = await prisma.account.findUniqueOrThrow({
      where: { id: newId },
      select: { closingDay: true, dueDay: true, recurrences: recurrenceSelect },
    })

    await prisma.$transaction(async (db) => {
      await db.transaction.updateMany({ where: { accountId: oldId }, data: { accountId: newId } })

      // Uma recorrente por (conta, chave, direção): na colisão fica a decisão
      // mais forte do usuário — confirmada, depois descartada, depois sugerida.
      for (const recurrence of old.recurrences) {
        const clash = target.recurrences.find(
          (r) => r.descriptionKey === recurrence.descriptionKey && r.direction === recurrence.direction,
        )
        if (clash) {
          if (RECURRENCE_STATUS_RANK[recurrence.status] <= RECURRENCE_STATUS_RANK[clash.status]) {
            await db.recurrence.delete({ where: { id: recurrence.id } })
            continue
          }
          await db.recurrence.delete({ where: { id: clash.id } })
        }
        await db.recurrence.update({ where: { id: recurrence.id }, data: { accountId: newId } })
      }

      const cycle = {
        ...(target.closingDay == null && old.closingDay != null ? { closingDay: old.closingDay } : {}),
        ...(target.dueDay == null && old.dueDay != null ? { dueDay: old.dueDay } : {}),
      }
      if (Object.keys(cycle).length > 0) {
        await db.account.update({ where: { id: newId }, data: cycle })
      }

      // As faturas antigas vão junto (Cascade): as da conta nova cobrem o mesmo período.
      await db.account.delete({ where: { id: oldId } })
    })
  }
}

async function syncBills(client: PluggyClient, accounts: SyncedAccount[], userId: string) {
  for (const account of accounts) {
    if (account.type !== 'CREDIT') continue
    const bills = await client.listBills(account.pluggyAccountId)
    for (const bill of bills) {
      const fields = {
        accountId: account.id,
        dueDate: toDbDate(pluggyDate(bill.dueDate)),
        totalCents: Math.round(bill.totalAmount * 100),
        paidCents: (bill.payments ?? []).reduce((sum, p) => sum + toCentsAbs(p.amount), 0),
      }
      await prisma.cardBill.upsert({
        where: { pluggyBillId: bill.id, userId },
        create: { ...fields, userId, pluggyBillId: bill.id },
        update: fields,
      })
    }
  }
}

async function pairTransfers(userId: string, today: IsoDate, windowDays: number) {
  const rows = await prisma.transaction.findMany({
    where: { userId, date: { gte: toDbDate(addDays(today, -windowDays)) } },
    select: {
      id: true,
      accountId: true,
      date: true,
      description: true,
      amountCents: true,
      isTransfer: true,
      transferLocked: true,
      transferPairId: true,
      transferPairOf: { select: { id: true } },
      account: { select: { type: true } },
    },
  })
  // Quem já tem par fica de fora mesmo sem `isTransfer`: `transferPairId` é único.
  const txs = rows
    .filter((r) => !r.transferPairId && !r.transferPairOf)
    .map((r) => ({ ...r, accountType: r.account.type, date: fromDbDate(r.date) }))

  const paired = new Set<string>()
  for (const [outId, inId] of detectTransferPairs(txs)) {
    paired.add(outId)
    paired.add(inId)
    await prisma.$transaction(async (db) => {
      await db.transaction.update({
        where: { id: outId },
        data: { isTransfer: true, transferPairId: inId },
      })
      await db.transaction.update({
        where: { id: inId },
        data: { isTransfer: true, transferPairId: outId },
      })
    })
  }

  let walletId: string | null = null
  for (const tx of txs) {
    if (paired.has(tx.id) || tx.isTransfer || tx.transferLocked || tx.amountCents === 0) continue

    // Pagamento de fatura sem par: a saída no banco e a entrada no cartão são
    // transferência; senão a fatura conta duas vezes ou a entrada vira estorno.
    const billPaymentSide =
      (tx.account.type === 'BANK' && tx.amountCents < 0 && isBillPaymentDescription(tx.description)) ||
      (tx.account.type === 'CREDIT' && tx.amountCents > 0 && isCardPaymentCreditDescription(tx.description))
    if (billPaymentSide) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { isTransfer: true } })
      continue
    }

    if (
      tx.account.type === 'BANK' &&
      tx.amountCents < 0 &&
      isWithdrawalDescription(tx.description)
    ) {
      walletId ??= (await ensureWalletAccount(userId)).id
      const wallet = walletId
      // O par (transferPairId nos dois lados) é o que torna isto idempotente:
      // na próxima sincronização o saque já é transferência e fica de fora.
      await prisma.$transaction(async (db) => {
        const credit = await db.transaction.create({
          data: {
            userId,
            accountId: wallet,
            date: toDbDate(tx.date),
            description: tx.description,
            descriptionKey: descriptionKey(tx.description),
            amountCents: Math.abs(tx.amountCents),
            status: 'POSTED',
            source: 'SYSTEM',
            isTransfer: true,
            transferPairId: tx.id,
          },
        })
        await db.transaction.update({
          where: { id: tx.id },
          data: { isTransfer: true, transferPairId: credit.id },
        })
      })
    }
  }

  if (walletId) await recomputeWalletBalance(walletId)
}
