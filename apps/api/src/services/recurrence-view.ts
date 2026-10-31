import { fromDbDate, toDbDate } from '@/lib/db-date'
import { addDays } from '@/lib/finance/business-days'
import { pickPayrollSource } from '@/lib/finance/payroll'
import type { AccountType, ProjectionRecurrence, ProjectionTx, RecurrenceKind } from '@/lib/finance/projection'
import { loanEndMonth, type MonthStatus, monthStatus, remainingInstallments } from '@/lib/finance/recurrence-progress'
import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

/** A ocorrência casa a até 5 dias da data esperada: a margem cobre o começo do mês. */
const MONTH_MARGIN_DAYS = 5

/** Campos do recorrente que a projeção e as parcelas precisam. */
export const recurrenceRuleSelect = {
  id: true,
  accountId: true,
  description: true,
  descriptionKey: true,
  direction: true,
  expectedAmountCents: true,
  dayRule: true,
  dayValue: true,
  nonBusinessDayPolicy: true,
  kind: true,
  status: true,
  remainingInstallments: true,
  remainingAsOf: true,
  payrollDeduction: true,
  payrollSourceId: true,
  transactions: { select: { date: true } },
  payrollLinks: { select: { transaction: { select: { date: true } } } },
  account: { select: { type: true } },
} as const

export type RecurrenceRuleRow = {
  id: string
  accountId: string | null
  description: string
  descriptionKey: string
  direction: 'IN' | 'OUT'
  expectedAmountCents: number
  dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'
  dayValue: number
  nonBusinessDayPolicy: 'ANTICIPATE' | 'POSTPONE' | 'KEEP'
  kind: RecurrenceKind
  status: 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED' | 'PAID_OFF'
  remainingInstallments: number | null
  remainingAsOf: Date | null
  payrollDeduction: boolean
  payrollSourceId: string | null
  transactions: { date: Date }[]
  payrollLinks: { transaction: { date: Date } }[]
  account: { type: AccountType } | null
}

/** Datas das parcelas: no desconto em folha, os salários vinculados; senão, as transações do recorrente. */
function linkedDatesOf(row: RecurrenceRuleRow): IsoDate[] {
  const dates = row.payrollDeduction ? row.payrollLinks.map((l) => l.transaction.date) : row.transactions.map((t) => t.date)
  return dates.map(fromDbDate).sort()
}

/**
 * O salário vinculado, como saída do próprio recorrente, para o status do mês:
 * o crédito é do recorrente do salário e não casaria pelo sinal nem pelo vínculo.
 */
function payrollTxs(row: RecurrenceRuleRow): ProjectionTx[] {
  return linkedDatesOf(row).map((date) => ({
    accountId: row.accountId ?? '',
    date,
    amountCents: row.direction === 'IN' ? 1 : -1,
    descriptionKey: row.descriptionKey,
    isTransfer: false,
    recurrenceId: row.id,
  }))
}

/** Parcelas que faltam do empréstimo (null fora de empréstimo ou sem número informado). */
export function remainingOf(row: RecurrenceRuleRow): number | null {
  if (row.kind !== 'LOAN') return null
  return remainingInstallments({
    remainingInstallments: row.remainingInstallments,
    remainingAsOf: row.remainingAsOf ? fromDbDate(row.remainingAsOf) : null,
    linkedDates: linkedDatesOf(row),
  })
}

/** Quitado: marcado à mão ou sem parcelas restantes. */
export function isPaidOff(row: RecurrenceRuleRow): boolean {
  return row.status === 'PAID_OFF' || remainingOf(row) === 0
}

export function toProjectionRecurrence(row: RecurrenceRuleRow): ProjectionRecurrence {
  const {
    account,
    status,
    remainingInstallments: _n,
    remainingAsOf: _asOf,
    transactions: _t,
    payrollLinks: _p,
    payrollSourceId: _s,
    ...rule
  } = row
  return { ...rule, accountType: account?.type ?? null, paidOff: isPaidOff(row) }
}

/** Linha completa para a tela: a regra, a conta com nome e as datas dos vínculos. */
export const recurrenceViewSelect = {
  ...recurrenceRuleSelect,
  account: { select: { name: true, type: true } },
} as const

export type RecurrenceViewRow = Omit<RecurrenceRuleRow, 'account'> & {
  account: { name: string; type: AccountType } | null
}

/** Recebimentos que podem ter parcela descontada em folha. */
export const payrollIncomeWhere = (userId: string) =>
  ({ userId, kind: 'MONTHLY', direction: 'IN', status: 'CONFIRMED' }) as const

export function isPayrollIncome(row: Pick<RecurrenceRuleRow, 'kind' | 'direction' | 'status'>): boolean {
  return row.kind === 'MONTHLY' && row.direction === 'IN' && row.status === 'CONFIRMED'
}

/** Os recebimentos do usuário, só quando o recorrente é descontado em folha. */
export async function loadPayrollIncomes(userId: string, row: { payrollDeduction: boolean }) {
  if (!row.payrollDeduction) return []
  return prisma.recurrence.findMany({ where: payrollIncomeWhere(userId), select: recurrenceRuleSelect })
}

export type RecurrenceView = Omit<
  RecurrenceViewRow,
  'transactions' | 'payrollLinks' | 'descriptionKey' | 'remainingAsOf'
> & {
  payrollSource: { id: string; description: string } | null
  paidOff: boolean
  monthStatus: MonthStatus | null
  linkedCount: number
  lastLinkedDate: IsoDate | null
  loan: { remaining: number | null; remainingCents: number | null; endMonth: string | null } | null
}

/** Transações perto do mês corrente, para o status do mês de cada recorrente. */
export async function loadMonthTxs(userId: string, today: IsoDate): Promise<ProjectionTx[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: toDbDate(addDays(`${today.slice(0, 7)}-01`, -MONTH_MARGIN_DAYS)), lte: toDbDate(addDays(today, 40)) },
    },
    select: { accountId: true, date: true, amountCents: true, descriptionKey: true, isTransfer: true, recurrenceId: true },
  })
  return rows.map((r) => ({ ...r, date: fromDbDate(r.date) }))
}

export function toRecurrenceView(
  row: RecurrenceViewRow,
  today: IsoDate,
  monthTxs: ProjectionTx[],
  incomes: RecurrenceRuleRow[] = [],
): RecurrenceView {
  const { transactions: _t, payrollLinks: _p, descriptionKey: _key, remainingAsOf: _asOf, ...fields } = row
  const ruleRow = { ...row, account: row.account ? { type: row.account.type } : null }
  const projection = toProjectionRecurrence(ruleRow)
  const txs = row.payrollDeduction ? payrollTxs(ruleRow) : monthTxs
  // Em folha a parcela cai junto com o salário: o vencimento é o dele.
  const source = row.payrollDeduction ? pickPayrollSource(row.payrollSourceId, incomes) : null
  const rule = source
    ? {
        ...projection,
        dayRule: source.dayRule,
        dayValue: source.dayValue,
        nonBusinessDayPolicy: source.nonBusinessDayPolicy,
      }
    : projection
  const status = row.status === 'CONFIRMED' || row.status === 'PAID_OFF' ? monthStatus(rule, today, txs) : null
  const dates = linkedDatesOf(ruleRow)
  const remaining = remainingOf(ruleRow)

  return {
    ...fields,
    payrollSource: source ? { id: source.id, description: source.description } : null,
    paidOff: projection.paidOff ?? false,
    monthStatus: status,
    linkedCount: dates.length,
    lastLinkedDate: dates.at(-1) ?? null,
    loan:
      row.kind === 'LOAN'
        ? {
            remaining,
            remainingCents: remaining === null ? null : remaining * row.expectedAmountCents,
            endMonth: remaining === null ? null : loanEndMonth(today, remaining, status?.state === 'PAID'),
          }
        : null,
  }
}
