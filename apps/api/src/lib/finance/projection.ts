import type { IsoDate } from '@/lib/today'

import { addDays } from './business-days'
import type { CardBillView } from './card-bills'
import { expectedDates, type RecurrenceRule } from './recurrence-schedule'

export type AccountType = 'BANK' | 'CREDIT' | 'WALLET'

export type ProjectionTx = {
  accountId: string
  date: IsoDate
  amountCents: number
  descriptionKey: string
  isTransfer: boolean
  /** Recorrente que o João escolheu para esta transação. */
  recurrenceId?: string | null
}

export type RecurrenceKind = 'MONTHLY' | 'LOAN' | 'EXTERNAL'

export type ProjectionRecurrence = RecurrenceRule & {
  id: string
  /** Sem conta, vale para qualquer uma (e conta como dinheiro). */
  accountId: string | null
  accountType: AccountType | null
  direction: 'IN' | 'OUT'
  description: string
  descriptionKey: string
  expectedAmountCents: number
  kind?: RecurrenceKind
  /** Empréstimo quitado (à mão ou sem parcelas restantes). */
  paidOff?: boolean
  /** Descontado em folha: já sai do salário, não do saldo. */
  payrollDeduction?: boolean
}

export type Payable = {
  kind: 'BILL' | 'RECURRENCE'
  refId: string
  description: string
  dueDate: IsoDate
  amountCents: number
}

export type Projection = {
  today: IsoDate
  balanceCents: number
  nextIncome: { recurrenceId: string; description: string; date: IsoDate; amountCents: number } | null
  windowEnd: IsoDate
  days: number
  noIncomeConfigured: boolean
  payables: Payable[]
  payableTotalCents: number
  availableCents: number
  perDayCents: number
}

const MATCH_WINDOW_DAYS = 5
const INCOME_LOOKAHEAD_DAYS = 62
const DAY_MS = 86_400_000

/** Dias corridos de `from` até `to` (`to − from`). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

function lastDayOfMonth(date: IsoDate): IsoDate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`
}

/** Conta de dinheiro: recorrente de cartão já está na fatura e não conta à parte. */
function isCashAccount(type: AccountType): boolean {
  return type === 'BANK' || type === 'WALLET'
}

/**
 * Recorrente que pesa no dinheiro: fora da Pluggy nunca chega ao saldo,
 * quitado já não se paga, o descontado em folha já veio abatido do salário e
 * o de cartão está na fatura. Sem conta conta como dinheiro.
 */
function affectsCash(rec: ProjectionRecurrence): boolean {
  if (rec.kind === 'EXTERNAL' || rec.paidOff || rec.payrollDeduction) return false
  return rec.accountType === null || isCashAccount(rec.accountType)
}

/** Pela regra (sem vínculo): mesma conta e texto ou valor a até 10%; sem conta, só o texto igual. */
function matchesByRule(rec: ProjectionRecurrence, t: ProjectionTx): boolean {
  if (t.recurrenceId != null) return false
  if (t.descriptionKey === rec.descriptionKey) return rec.accountId === null || t.accountId === rec.accountId
  // Até 10% de diferença, em inteiros para não errar por ponto flutuante.
  return (
    t.accountId === rec.accountId &&
    10 * Math.abs(Math.abs(t.amountCents) - rec.expectedAmountCents) <= rec.expectedAmountCents
  )
}

export function findOccurrenceTx(
  rec: ProjectionRecurrence,
  expected: IsoDate,
  txs: ProjectionTx[],
): ProjectionTx | undefined {
  const sign = rec.direction === 'IN' ? 1 : -1
  const eligible = txs.filter((t) => !t.isTransfer && Math.sign(t.amountCents) === sign)
  const near = (t: ProjectionTx) => Math.abs(daysBetween(expected, t.date)) <= MATCH_WINDOW_DAYS
  // O vínculo do João vem antes da regra, em qualquer conta, e vale o mês todo:
  // quem paga no dia 6 o que foi cadastrado para o 15 já pagou o mês.
  const linked = eligible.filter((t) => t.recurrenceId === rec.id)
  return (
    linked.find((t) => t.date.slice(0, 7) === expected.slice(0, 7)) ??
    linked.find(near) ??
    eligible.find((t) => near(t) && matchesByRule(rec, t))
  )
}

export function isOccurrenceMatched(
  rec: ProjectionRecurrence,
  expected: IsoDate,
  txs: ProjectionTx[],
): boolean {
  return findOccurrenceTx(rec, expected, txs) !== undefined
}

/**
 * Datas esperadas em `[from, to]` ainda sem transação que as cumpra.
 *
 * Cada transação cumpre no máximo uma ocorrência do recorrente, para um
 * depósito não valer por dois meses.
 */
function unmatchedDates(
  rec: ProjectionRecurrence,
  from: IsoDate,
  to: IsoDate,
  txs: ProjectionTx[],
): IsoDate[] {
  let available = txs
  return expectedDates(rec, from, to).filter((date) => {
    const tx = findOccurrenceTx(rec, date, available)
    if (tx) available = available.filter((t) => t !== tx)
    return tx === undefined
  })
}

export function computeProjection(input: {
  today: IsoDate
  accounts: { id: string; type: AccountType; balanceCents: number }[]
  recurrences: ProjectionRecurrence[]
  transactions: ProjectionTx[]
  cardBills: CardBillView[]
  /** Nome de cada cartão por `accountId`, para o rótulo da fatura. */
  cardNames?: Record<string, string>
}): Projection {
  const { today, accounts, recurrences, transactions, cardBills, cardNames = {} } = input
  // Ocorrência de até 5 dias atrás que ainda não aconteceu continua valendo.
  const from = addDays(today, -MATCH_WINDOW_DAYS)

  const balanceCents = accounts
    .filter((a) => isCashAccount(a.type))
    .reduce((sum, a) => sum + a.balanceCents, 0)

  const cashRecurrences = recurrences.filter(affectsCash)

  let nextIncome: Projection['nextIncome'] = null
  for (const rec of cashRecurrences.filter((r) => r.direction === 'IN')) {
    const [date] = unmatchedDates(rec, from, addDays(today, INCOME_LOOKAHEAD_DAYS), transactions)
    if (date === undefined) continue
    // Recebimento atrasado é esperado para hoje, não para o passado.
    const incomeDate = date > today ? date : today
    if (nextIncome === null || incomeDate < nextIncome.date) {
      nextIncome = {
        recurrenceId: rec.id,
        description: rec.description,
        date: incomeDate,
        amountCents: rec.expectedAmountCents,
      }
    }
  }

  const windowEnd = nextIncome?.date ?? lastDayOfMonth(today)

  const recurrencePayables: Payable[] = cashRecurrences
    .filter((r) => r.direction === 'OUT')
    .flatMap((rec) =>
      unmatchedDates(rec, from, windowEnd, transactions).map((dueDate) => ({
        kind: 'RECURRENCE' as const,
        refId: rec.id,
        description: rec.description,
        dueDate,
        amountCents: rec.expectedAmountCents,
      })),
    )

  // Fatura tem o pago registrado; vencida e não paga continua devida, por mais antiga que seja.
  const billPayables: Payable[] = cardBills
    .filter((b) => b.remainingCents > 0 && b.dueDate <= windowEnd)
    .map((b) => ({
      kind: 'BILL' as const,
      // O cartão tem uma fatura por vencimento; só o `accountId` repetiria a chave.
      refId: `${b.accountId}:${b.dueDate}`,
      description: cardNames[b.accountId] ? `Fatura ${cardNames[b.accountId]}` : 'Fatura do cartão',
      dueDate: b.dueDate,
      amountCents: b.remainingCents,
    }))

  const payables = [...recurrencePayables, ...billPayables].sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
  )
  const payableTotalCents = payables.reduce((sum, p) => sum + p.amountCents, 0)
  // O recebimento que fecha a janela não entra: o dinheiro dele é da próxima.
  const availableCents = balanceCents - payableTotalCents
  const days = Math.max(1, daysBetween(today, windowEnd))

  return {
    today,
    balanceCents,
    nextIncome,
    windowEnd,
    days,
    noIncomeConfigured: nextIncome === null,
    payables,
    payableTotalCents,
    availableCents,
    // `|| 0` evita o `-0` de `Math.trunc(-0.3)`.
    perDayCents: Math.trunc(availableCents / days) || 0,
  }
}
