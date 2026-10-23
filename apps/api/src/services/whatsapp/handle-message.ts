import {
  type EntryAccount,
  type EntryDraft,
  GeminiUnavailableError,
  interpretEntry,
} from '@/lib/gemini/interpret-entry'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'
import { ensureWalletAccount } from '@/services/wallet'

import {
  type AccountOption,
  isUndo,
  lastEntry,
  rememberLastEntry,
  resolveAccountAnswer,
  setPending,
  takePending,
} from './conversation'
import {
  askAccountReply,
  GEMINI_DOWN_REPLY,
  renamedReply,
  savedReply,
  UNSUPPORTED_REPLY,
  undoReply,
} from './replies'
import { saveWhatsappEntry, undoWhatsappEntry } from './save-entry'

export type IncomingMessage = {
  id: string
  from: string
  text?: string
  imageId?: string
  unsupported?: true
}

export type WhatsappSender = {
  sendText(to: string, body: string): Promise<void>
  downloadMedia(id: string): Promise<{ data: Buffer; mimeType: string }>
}

type Deps = {
  client: WhatsappSender
  interpret?: typeof interpretEntry
  today?: IsoDate
  now?: Date
}

/** Uma mensagem recebida: grava, pergunta a conta ou responde. Erros inesperados sobem. */
export async function handleWhatsappMessage(msg: IncomingMessage, deps: Deps): Promise<void> {
  const { client } = deps
  const reply = (body: string) => client.sendText(msg.from, body)

  const user = await prisma.user.findUnique({
    where: { whatsappPhone: msg.from },
    select: { id: true },
  })
  if (!user) return
  const userId = user.id

  if (msg.unsupported) return reply(UNSUPPORTED_REPLY)

  const today = deps.today ?? todayIso()
  const text = msg.text?.trim()

  if (text && isUndo(text)) {
    return reply(undoReply(await undoWhatsappEntry(userId, lastEntry(userId))))
  }

  async function save(draft: EntryDraft, accountId: string, messageId: string) {
    const result = await saveWhatsappEntry(userId, { draft, accountId, messageId })
    if (result.kind === 'duplicate') return
    rememberLastEntry(userId, messageId)
    const fields = { ...draft, accountName: result.accountName }
    await reply(
      result.kind === 'renamed' ? renamedReply(fields, today) : savedReply(fields, today),
    )
  }

  // Um pendente só vale para a próxima mensagem; se ela não responde, é nova.
  const pending = takePending(userId, deps.now)
  if (pending && text) {
    const accountId = resolveAccountAnswer(text, pending.options)
    if (accountId) return save(pending.draft, accountId, pending.messageId)
  }

  try {
    const interpret = deps.interpret ?? interpretEntry

    const [dbAccounts, wallet] = await Promise.all([
      prisma.account.findMany({
        where: { userId, type: { in: ['BANK', 'CREDIT'] } },
        select: { id: true, name: true, type: true },
      }),
      ensureWalletAccount(userId),
    ])
    const accounts: EntryAccount[] = [
      ...dbAccounts,
      { id: wallet.id, name: wallet.name, type: 'WALLET' },
    ]

    const image = msg.imageId ? await client.downloadMedia(msg.imageId) : undefined
    const result = await interpret({ text, image, accounts, today })

    if (result.kind === 'entry') return save(result.draft, result.accountId, msg.id)

    if (result.kind === 'ask_account') {
      const options: AccountOption[] = []
      for (const id of result.candidateAccountIds) {
        const account = accounts.find((a) => a.id === id)
        if (account) options.push({ accountId: id, label: account.name })
      }
      options.push({ accountId: wallet.id, label: 'Dinheiro (Carteira)' })
      setPending(userId, {
        draft: result.draft,
        options,
        messageId: msg.id,
        at: deps.now ?? new Date(),
      })
      return reply(askAccountReply(result.draft, options))
    }

    return reply(result.reply)
  } catch (error) {
    if (error instanceof GeminiUnavailableError) return reply(GEMINI_DOWN_REPLY)
    throw error
  }
}
