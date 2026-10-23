import type { EntryDraft } from '@/lib/gemini/interpret-entry'

// Estado da conversa só em memória, como o sync serializado: vale para uma
// instância só e some no restart (o pendente é de 30 min, perder é barato).

export const PENDING_TTL_MS = 30 * 60 * 1000

export type AccountOption = { accountId: string; label: string }
export type PendingEntry = {
  draft: EntryDraft
  options: AccountOption[]
  messageId: string
  at: Date
}

const pendings = new Map<string, PendingEntry>()
const lastEntries = new Map<string, string>()

/** Só para testes. */
export function resetConversation() {
  pendings.clear()
  lastEntries.clear()
}

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function setPending(userId: string, pending: PendingEntry) {
  pendings.set(userId, pending)
}

/** Tira o pendente sempre; se passou do prazo, devolve `undefined`. */
export function takePending(userId: string, now: Date = new Date()): PendingEntry | undefined {
  const pending = pendings.get(userId)
  pendings.delete(userId)
  if (!pending) return undefined
  return now.getTime() - pending.at.getTime() > PENDING_TTL_MS ? undefined : pending
}

// Palavras que quase toda conta tem; não identificam qual é.
const GENERIC_WORDS = new Set([
  'conta',
  'corrente',
  'banco',
  'cartao',
  'credito',
  'do',
  'da',
  'de',
  'no',
  'na',
])

const MAX_ANSWER_WORDS = 3

const words = (text: string) => text.split(/[^a-z0-9]+/).filter(Boolean)

/**
 * O número da opção ou o nome da conta, e só isso: uma mensagem nova ("café 5
 * itau") não pode ser tomada por resposta. Ambíguo ou desconhecido → `null`.
 */
export function resolveAccountAnswer(text: string, options: AccountOption[]): string | null {
  const trimmed = text.trim()
  if (/^\d+$/.test(trimmed)) return options[Number(trimmed) - 1]?.accountId ?? null

  const answer = normalize(text)
  if (!answer || /\d/.test(answer)) return null
  const answerWords = words(answer)
  if (answerWords.length > MAX_ANSWER_WORDS) return null
  const distinctive = answerWords.filter((w) => !GENERIC_WORDS.has(w))
  if (!distinctive.length) return null

  const matches = options.filter((option) => {
    const labelWords = words(normalize(option.label))
    return distinctive.every((w) => labelWords.includes(w))
  })
  return matches.length === 1 ? matches[0].accountId : null
}

export function rememberLastEntry(userId: string, messageId: string) {
  lastEntries.set(userId, messageId)
}

export function lastEntry(userId: string): string | undefined {
  return lastEntries.get(userId)
}

export function isUndo(text: string): boolean {
  return ['desfazer', 'apaga', 'apagar'].includes(normalize(text))
}
