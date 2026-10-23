import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { descriptionKey } from '@/lib/finance/description-key'
import { MATCH_WINDOW_DAYS, pickEntryMatch } from '@/lib/finance/match-entry'
import type { EntryDraft } from '@/lib/gemini/interpret-entry'
import { prisma } from '@/lib/prisma'
import type { AccountType } from '@/prisma/generated/client'
import { runExclusive } from '@/services/user-queue'
import { recomputeWalletBalance } from '@/services/wallet'

export type SaveResult =
  | { kind: 'created' | 'renamed'; accountName: string; accountType: AccountType }
  | { kind: 'duplicate' }

export type UndoResult = { kind: 'deleted' | 'restored' | 'nothing' }

// O único unique que estas escritas podem violar é `whatsappMessageId`: a mesma
// mensagem entregue de novo pelo webhook.
function isUniqueViolation(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
  )
}

/**
 * Grava o lançamento vindo do WhatsApp. Se a Pluggy já trouxe a mesma
 * transação, só renomeia; senão cria um manual que o sync substitui depois.
 * Roda na fila do usuário para não cruzar com o sync.
 */
export function saveWhatsappEntry(
  userId: string,
  input: { draft: EntryDraft; accountId: string; messageId: string },
): Promise<SaveResult> {
  const { draft, accountId, messageId } = input

  return runExclusive(userId, async () => {
    const account = await prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true, name: true, type: true },
    })
    if (!account) throw new Error('Conta não encontrada')

    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        accountId,
        source: 'PLUGGY',
        descriptionLocked: false,
        amountCents: draft.amountCents,
        date: {
          gte: toDbDate(addDays(draft.date, -MATCH_WINDOW_DAYS)),
          lte: toDbDate(addDays(draft.date, MATCH_WINDOW_DAYS)),
        },
      },
      select: {
        id: true,
        accountId: true,
        amountCents: true,
        date: true,
        createdAt: true,
        description: true,
        originalDescription: true,
      },
    })
    const matchId = pickEntryMatch(
      { accountId, amountCents: draft.amountCents, date: draft.date },
      candidates.map((c) => ({ ...c, date: fromDbDate(c.date) })),
    )
    const match = candidates.find((c) => c.id === matchId)
    const category = draft.category ? { category: draft.category, categoryLocked: true } : {}

    try {
      if (match) {
        await prisma.transaction.update({
          where: { id: match.id },
          data: {
            // Com descrição travada, `originalDescription` é o texto do banco
            // (o sync o mantém e a detecção de transferência lê dele).
            originalDescription: match.originalDescription ?? match.description,
            description: draft.description,
            descriptionKey: descriptionKey(draft.description),
            descriptionLocked: true,
            whatsappMessageId: messageId,
            ...category,
          },
        })
        return { kind: 'renamed', accountName: account.name, accountType: account.type }
      }

      await prisma.transaction.create({
        data: {
          userId,
          accountId,
          date: toDbDate(draft.date),
          description: draft.description,
          descriptionKey: descriptionKey(draft.description),
          amountCents: draft.amountCents,
          status: 'POSTED',
          source: 'MANUAL',
          whatsappMessageId: messageId,
          ...category,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error)) return { kind: 'duplicate' }
      throw error
    }

    if (account.type === 'WALLET') await recomputeWalletBalance(account.id)
    return { kind: 'created', accountName: account.name, accountType: account.type }
  })
}

/**
 * Desfaz o lançamento da mensagem: o manual é apagado; a transação da Pluggy
 * renomeada volta ao texto do banco (a categoria posta pela mensagem fica).
 */
export function undoWhatsappEntry(
  userId: string,
  messageId: string | undefined,
): Promise<UndoResult> {
  if (!messageId) return Promise.resolve({ kind: 'nothing' })

  return runExclusive(userId, async () => {
    const transaction = await prisma.transaction.findFirst({
      where: { whatsappMessageId: messageId, userId },
      select: {
        id: true,
        accountId: true,
        source: true,
        description: true,
        originalDescription: true,
        account: { select: { type: true } },
      },
    })
    if (!transaction) return { kind: 'nothing' }

    if (transaction.source === 'MANUAL') {
      await prisma.transaction.delete({ where: { id: transaction.id } })
      if (transaction.account.type === 'WALLET') {
        await recomputeWalletBalance(transaction.accountId)
      }
      return { kind: 'deleted' }
    }

    const description = transaction.originalDescription ?? transaction.description
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        description,
        descriptionKey: descriptionKey(description),
        descriptionLocked: false,
        whatsappMessageId: null,
        originalDescription: null,
      },
    })
    return { kind: 'restored' }
  })
}
