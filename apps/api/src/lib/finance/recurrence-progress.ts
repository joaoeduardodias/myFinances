import type { IsoDate } from '@/lib/today'

import { daysBetween, findOccurrenceTx, type ProjectionRecurrence, type ProjectionTx } from './projection'
import { expectedDates } from './recurrence-schedule'

/**
 * Parcelas que faltam: o número que o João informou menos as vinculadas com
 * data depois do dia em que informou. Desvincular devolve a parcela; uma
 * parcela antiga vinculada depois não desconta de novo.
 */
export function remainingInstallments(input: {
  remainingInstallments: number | null
  remainingAsOf: IsoDate | null
  linkedDates: IsoDate[]
}): number | null {
  if (input.remainingInstallments === null) return null
  const asOf = input.remainingAsOf
  const paidSince = input.linkedDates.filter((d) => asOf === null || d > asOf).length
  return Math.max(0, input.remainingInstallments - paidSince)
}

/** Mês (`YYYY-MM`) da última parcela: a deste mês conta se ainda não foi paga. */
export function loanEndMonth(today: IsoDate, remaining: number, paidThisMonth: boolean): string | null {
  if (remaining <= 0) return null
  const monthIndex = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1
  const end = monthIndex + remaining - (paidThisMonth ? 0 : 1)
  return `${Math.floor(end / 12)}-${String((end % 12) + 1).padStart(2, '0')}`
}

export type MonthStatus = { state: 'PAID' | 'DUE' | 'LATE'; date: IsoDate; days: number }

function monthBounds(today: IsoDate): [IsoDate, IsoDate] {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [`${today.slice(0, 7)}-01`, `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`]
}

/**
 * Situação do recorrente no mês de `today`, pela primeira data esperada do mês.
 * Quitado já não se paga: sem status. Fora da Pluggy nunca recebe transação:
 * conta como feito na data (pedido do João: o VA cai sempre no 5º dia útil).
 */
export function monthStatus(rec: ProjectionRecurrence, today: IsoDate, txs: ProjectionTx[]): MonthStatus | null {
  if (rec.paidOff) return null
  const [first, last] = monthBounds(today)
  const [expected] = expectedDates(rec, first, last)
  if (expected === undefined) return null
  if (rec.kind === 'EXTERNAL') {
    const days = daysBetween(today, expected)
    return days > 0 ? { state: 'DUE', date: expected, days } : { state: 'PAID', date: expected, days: 0 }
  }

  const tx = findOccurrenceTx(rec, expected, txs)
  if (tx) return { state: 'PAID', date: tx.date, days: 0 }
  const days = daysBetween(today, expected)
  return days >= 0 ? { state: 'DUE', date: expected, days } : { state: 'LATE', date: expected, days: -days }
}
