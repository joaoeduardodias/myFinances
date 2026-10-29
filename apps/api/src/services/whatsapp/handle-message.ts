import type { FastifyBaseLogger } from 'fastify'

import {
  type EntryAccount,
  type EntryDraft,
  GeminiUnavailableError,
  interpretEntry,
} from '@/lib/gemini/interpret-entry'
import { prisma } from '@/lib/prisma'
import { type IsoDate, todayIso } from '@/lib/today'
import { askAdvisor } from '@/services/ask-advisor'
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
  ADVISOR_DOWN_REPLY,
  askAccountReply,
  CANCELLED_REPLY,
  ERROR_REPLY,
  GEMINI_DOWN_REPLY,
  QUESTION_IN_TEXT_REPLY,
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
  askAdvisor?: typeof askAdvisor
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

const foldText = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
// O sync nomeia as contas "Conta Corrente X" / "Conta Poupança X" / "Cartão Crédito X".
const isSavings = (a: EntryAccount) => a.type === 'BANK' && foldText(a.name).includes('poupanca')
const optionRank = (a: EntryAccount) => (isSavings(a) ? 2 : a.type === 'CREDIT' ? 1 : 0)
/** "Conta Corrente Mercado Pago" → "mercado pago": o banco, para achar na mensagem. */
const institutionOf = (a: EntryAccount) =>
  foldText(a.name).replace(/^(conta corrente|conta poupanca|cartao credito)\s+/, '')

/** Uma mensagem recebida: grava, pergunta a conta ou responde. Erros inesperados sobem. */
export async function handleWhatsappMessage(msg: IncomingMessage, deps: Deps): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { whatsappPhone: { in: phoneVariants(msg.from) } },
    select: { id: true, whatsappPhone: true },
  })
  if (!user?.whatsappPhone) {
    // Sem resposta (não revela que o número existe), mas deixa rastro para diagnóstico.
    deps.log?.info(`Mensagem do WhatsApp de número não cadastrado (…${msg.from.slice(-4)}).`)
    return
  }

  // Responde ao número cadastrado, não ao `from`: a Meta manda o celular BR sem
  // o 9, e o número de teste só envia para a lista de permissão, que tem o 9.
  const to = user.whatsappPhone
  const reply = (body: string) => deps.client.sendText(to, body)

  try {
    return await processMessage(msg, deps, user.id, reply)
  } catch (error) {
    // Sem resposta o usuário acharia que salvou; o aviso é best effort e o
    // erro sobe para o webhook registrar.
    try {
      await reply(ERROR_REPLY)
    } catch {}
    throw error
  }
}

async function processMessage(
  msg: IncomingMessage,
  deps: Deps,
  userId: string,
  reply: (body: string) => Promise<void>,
): Promise<void> {
  const { client } = deps

  if (msg.unsupported) return reply(UNSUPPORTED_REPLY)

  const today = deps.today ?? todayIso()
  const text = msg.text?.trim()
  // "desfazer?" e "1?" continuam sendo desfazer e resposta, não pergunta ao consultor.
  const bare = text?.replace(/\?+$/, '').trim()

  // Pendente vivo + "desfazer": cancela o pendente; apagar o lançamento
  // anterior seria apagar o que o usuário não quis dizer.
  const pending = takePending(userId, deps.now)
  if (bare && isUndo(bare)) {
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
  if (pending && bare) {
    const accountId = resolveAccountAnswer(bare, pending.options)
    if (accountId) return save(pending.draft, accountId, pending.messageId)
  }

  try {
    const interpret = deps.interpret ?? interpretEntry
    const ask = async (question: string) => {
      const answer = await (deps.askAdvisor ?? askAdvisor)(userId, question, today)
      return reply(answer.kind === 'answer' ? answer.text : ADVISOR_DOWN_REPLY)
    }

    // Texto que termina em "?" é pergunta, mesmo que pareça lançamento
    // ("almoço 45 pix nubank?"): vai direto, sem gastar a chamada do interpret.
    if (text && !msg.imageId && text.endsWith('?')) return await ask(text)

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

    if (result.kind === 'question') return text ? ask(text) : reply(QUESTION_IN_TEXT_REPLY)

    if (result.kind === 'entry') return save(result.draft, result.accountId, msg.id)

    if (result.kind === 'ask_account') {
      const folded = foldText(text ?? '')
      // "débito" já descarta cartão e Carteira: valem as contas do banco (todas,
      // não só as que o Gemini sugeriu), ou só as do banco citado na mensagem.
      const debit = /\bdebito\b/.test(folded)
      let pool = debit
        ? accounts.filter((a) => a.type === 'BANK')
        : [...new Set(result.candidateAccountIds)]
            .map((id) => accounts.find((a) => a.id === id))
            .filter((a): a is EntryAccount => !!a && a.type !== 'WALLET')
      if (debit) {
        const named = pool.filter((a) => folded.includes(institutionOf(a)))
        if (named.length) pool = named
      }
      // Compra no débito ou pix sai da corrente: a poupança só entra se a
      // mensagem falar nela. Se sobrar uma conta, não há o que perguntar.
      const narrowed = folded.includes('poupanca') ? pool : pool.filter((a) => !isSavings(a))
      if (narrowed.length === 1 && (debit || pool.length > 1)) {
        return save(result.draft, narrowed[0].id, msg.id)
      }
      // Corrente primeiro, depois cartão, poupança; a Carteira uma vez só, por último.
      const options: AccountOption[] = (narrowed.length ? narrowed : pool)
        .sort((a, b) => optionRank(a) - optionRank(b))
        .map((a) => ({ accountId: a.id, label: a.name }))
      if (!debit) options.push({ accountId: wallet.id, label: 'Dinheiro (Carteira)' })
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
    if (error instanceof GeminiUnavailableError) {
      // Sem isso só o usuário sabe que falhou (ex.: modelo aposentado pelo Google).
      deps.log?.info(`Gemini indisponível: ${error.message}`)
      return reply(GEMINI_DOWN_REPLY)
    }
    throw error
  }
}
