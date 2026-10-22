import type { IsoDate } from '@/lib/today'

import { addDays } from './business-days'

export type CardTx = {
  date: IsoDate
  amountCents: number
  isTransfer: boolean
  installmentNumber?: number | null
  totalInstallments?: number | null
  description: string
}

export type PluggyBillLite = { dueDate: IsoDate; totalCents: number; paidCents: number }

export type CardBillView = {
  accountId: string
  closeDate: IsoDate
  dueDate: IsoDate
  amountCents: number
  paidCents: number
  remainingCents: number
  status: 'CLOSED' | 'OPEN' | 'FUTURE'
  transactions: CardTx[]
}

const MAX_BILLS_AFTER_OPEN = 12
const PLUGGY_DUE_TOLERANCE_DAYS = 3

/** Mês absoluto: `ano * 12 + (mês - 1)`, para andar de mês em mês sem virar o ano na mão. */
type MonthIndex = number

function monthIndexOf(date: IsoDate): MonthIndex {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
}

/** Dia `day` do mês, limitado ao último dia dele (dia 31 em fevereiro vira 28/29). */
function dayInMonth(month: MonthIndex, day: number): IsoDate {
  const year = Math.floor(month / 12)
  const monthOfYear = (month % 12) + 1
  const lastDay = new Date(Date.UTC(year, monthOfYear, 0)).getUTCDate()
  return `${year}-${String(monthOfYear).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

/**
 * Faturas do cartão calculadas pelos ciclos de fechamento, da última fechada
 * até a última com compra (parcelas futuras incluídas), no máximo 12 depois da
 * aberta. Cada fatura é identificada pelo mês do vencimento.
 */
export function computeCardBills(input: {
  accountId: string
  closingDay: number
  dueDay: number
  transactions: CardTx[]
  pluggyBills: PluggyBillLite[]
  today: IsoDate
}): CardBillView[] {
  const { accountId, closingDay, dueDay, transactions, pluggyBills, today } = input

  // Fechamento antes do vencimento no mesmo mês; senão, fecha no mês anterior.
  const closeMonthOffset = closingDay < dueDay ? 0 : -1
  const closeDateOf = (dueMonth: MonthIndex) => dayInMonth(dueMonth + closeMonthOffset, closingDay)
  const dueDateOf = (dueMonth: MonthIndex) => dayInMonth(dueMonth, dueDay)

  /** Mês de vencimento da fatura cujo ciclo `(fechamentoAnterior, fechamento]` contém `date`. */
  const cycleOf = (date: IsoDate): MonthIndex => {
    let dueMonth = monthIndexOf(date) - closeMonthOffset
    while (date > closeDateOf(dueMonth)) dueMonth += 1
    while (date <= closeDateOf(dueMonth - 1)) dueMonth -= 1
    return dueMonth
  }

  const openMonth = cycleOf(today)
  const firstMonth = openMonth - 1
  const purchases = transactions.filter((t) => !t.isTransfer)
  const lastWithPurchase = Math.max(openMonth, ...purchases.map((t) => cycleOf(t.date)))
  const lastMonth = Math.min(lastWithPurchase, openMonth + MAX_BILLS_AFTER_OPEN)

  const bills: CardBillView[] = []
  for (let dueMonth = firstMonth; dueMonth <= lastMonth; dueMonth += 1) {
    const previousClose = closeDateOf(dueMonth - 1)
    const closeDate = closeDateOf(dueMonth)
    const nextClose = closeDateOf(dueMonth + 1)
    const dueDate = dueDateOf(dueMonth)

    const cycleTransactions = purchases.filter((t) => t.date > previousClose && t.date <= closeDate)
    let amountCents = cycleTransactions.reduce((sum, t) => sum - t.amountCents, 0)
    // Paga-se a fatura depois que ela fecha, até o fechamento seguinte.
    let paidCents = transactions
      .filter((t) => t.isTransfer && t.amountCents > 0 && t.date > closeDate && t.date <= nextClose)
      .reduce((sum, t) => sum + t.amountCents, 0)

    const minDue = addDays(dueDate, -PLUGGY_DUE_TOLERANCE_DAYS)
    const maxDue = addDays(dueDate, PLUGGY_DUE_TOLERANCE_DAYS)
    const pluggy = pluggyBills.find((b) => b.dueDate >= minDue && b.dueDate <= maxDue)
    if (pluggy) {
      amountCents = pluggy.totalCents
      paidCents = Math.max(pluggy.paidCents, paidCents)
    }

    const status = today > closeDate ? 'CLOSED' : today > previousClose ? 'OPEN' : 'FUTURE'

    bills.push({
      accountId,
      closeDate,
      dueDate,
      amountCents,
      paidCents,
      // Pagar a mais não vira saldo a pagar negativo.
      remainingCents: Math.max(0, amountCents - paidCents),
      status,
      transactions: cycleTransactions,
    })
  }
  return bills
}
