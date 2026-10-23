import type { FastifyBaseLogger } from 'fastify'

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
  CANCELLED_REPLY,
  ERROR_REPLY,
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
  log?: Pick<FastifyBaseLogger, 'info'>
}

/**
 * A Meta manda o número de muitos celulares brasileiros sem o 9 depois do DDD
 * (`551199999999`), mas o cadastro costuma ter o 9. Procura pelas duas formas.
 */
export function phoneVariants(digits: string): string[] {
  const variants = [digits]
  if (/^55\d{2}9\d{8}$/.test(digits)) variants.push(digits.slice(0, 4) + digits.slice(5))
  else if (/^55\d{2}\d{8}$/.test(digits)) variants.push(`${digits.slice(0, 4)}9${digits.slice(4)}`)
  return variants
}

/** Uma mensagem recebida: grava, pergunta a conta ou responde. Erros inesperados sobem. */
export async function handleWhatsappMessage(msg: IncomingMessage, deps: Deps): Promise<void> {
  const { client } = deps
  const reply = (body: string) => client.sendText(msg.from, body)

  const user = await prisma.user.findFirst({
    where: { whatsappPhone: { in: phoneVariants(msg.from) } },
    select: { id: true },
  })
  if (!user) {
    // Sem resposta (não revela que o número existe), mas deixa rastro para diagnóstico.
    deps.log?.info(`Mensagem do WhatsApp de número não cadastrado (…${msg.from.slice(-4)}).`)
    return
  }

  try {
    return await processMessage(msg, deps, user.id)
  } catch (error) {
    // Sem resposta o usuário acharia que salvou; o aviso é best effort e o
    // erro sobe para o webhook registrar.
    try {
      await reply(ERROR_REPLY)
    } catch {}
    throw error
  }
}

async function processMessage(msg: IncomingMessage, deps: Deps, userId: string): Promise<void> {
  const { client } = deps
  const reply = (body: string) => client.sendText(msg.from, body)

  if (msg.unsupported) return reply(UNSUPPORTED_REPLY)

  const today = deps.today ?? todayIso()
  const text = msg.text?.trim()

  // Pendente vivo + "desfazer": cancela o pendente; apagar o lançamento
  // anterior seria apagar o que o usuário não quis dizer.
  const pending = takePending(userId, deps.now)
  if (text && isUndo(text)) {
    if (pending) return reply(CANCELLED_REPLY)
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
      ...dbAccounts.filter((a) => a.type !== 'WALLET'),
      { id: wallet.id, name: wallet.name, type: 'WALLET' },
    ]

    const image = msg.imageId ? await client.downloadMedia(msg.imageId) : undefined
    const result = await interpret({ text, image, accounts, today })

    if (result.kind === 'entry') return save(result.draft, result.accountId, msg.id)

    if (result.kind === 'ask_account') {
      // A Carteira entra uma vez só, sempre por último.
      const options: AccountOption[] = []
      for (const id of new Set(result.candidateAccountIds)) {
        const account = accounts.find((a) => a.id === id)
        if (account && account.type !== 'WALLET') options.push({ accountId: id, label: account.name })
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
