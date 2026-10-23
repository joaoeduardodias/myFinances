import { addDays } from '@/lib/finance/business-days'
import type { EntryDraft } from '@/lib/gemini/interpret-entry'
import type { IsoDate } from '@/lib/today'

import type { AccountOption } from './conversation'
import type { UndoResult } from './save-entry'

type EntryReply = {
  description: string
  amountCents: number
  accountName: string
  date: IsoDate
  category: string | null
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// O Intl põe um espaço sem quebra depois do "R$".
function money(cents: number) {
  return brl.format(Math.abs(cents) / 100).replace(/\s/g, ' ')
}

function dateLabel(date: IsoDate, today: IsoDate) {
  if (date === today) return 'hoje'
  if (date === addDays(today, -1)) return 'ontem'
  const [, month, day] = date.split('-')
  return `${day}/${month}`
}

export function savedReply(r: EntryReply, today: IsoDate) {
  const parts = [
    r.description,
    money(r.amountCents),
    r.amountCents < 0 ? 'débito' : 'crédito',
    r.accountName,
    dateLabel(r.date, today),
  ]
  if (r.category) parts.push(r.category)
  return `✅ ${parts.join(' · ')}\nResponda *desfazer* para apagar.`
}

export function renamedReply(r: EntryReply, today: IsoDate) {
  return `✅ Essa já tinha chegado do banco: agora se chama ${r.description} · ${money(r.amountCents)} · ${r.accountName} · ${dateLabel(r.date, today)}\nResponda *desfazer* para voltar o nome.`
}

export function askAccountReply(draft: EntryDraft, options: AccountOption[]) {
  const lines = options.map((option, i) => `${i + 1}) ${option.label}`)
  return `${draft.description} · ${money(draft.amountCents)} — de qual conta?\n${lines.join('\n')}`
}

export function undoReply(r: UndoResult) {
  if (r.kind === 'deleted') return '🗑️ Apagado.'
  if (r.kind === 'restored') return '↩️ Voltei o nome que veio do banco.'
  return 'Não achei nada recente para desfazer.'
}

export const UNSUPPORTED_REPLY = 'Por enquanto só entendo texto e foto de comprovante.'
export const CANCELLED_REPLY = 'Cancelado.'
export const ERROR_REPLY = 'Deu um erro aqui e não salvei. Tenta de novo em instantes.'
export const GEMINI_DOWN_REPLY = 'Não consegui entender agora, tenta de novo em instantes.'
