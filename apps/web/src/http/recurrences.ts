import type { IsoDate } from '@/lib/types'

import { api } from './api'

export type RecurrenceStatus =
  | 'SUGGESTED'
  | 'CONFIRMED'
  | 'DISMISSED'
  | 'PAID_OFF'
export type RecurrenceKind = 'MONTHLY' | 'LOAN' | 'EXTERNAL'
export type RecurrenceDirection = 'IN' | 'OUT'
export type DayRule = 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'
export type NonBusinessDayPolicy = 'ANTICIPATE' | 'POSTPONE' | 'KEEP'

export interface MonthStatus {
  state: 'PAID' | 'DUE' | 'LATE'
  date: IsoDate
  days: number
}

export interface Recurrence {
  id: string
  /** Sem conta, vale para qualquer uma. */
  accountId: string | null
  kind: RecurrenceKind
  description: string
  direction: RecurrenceDirection
  expectedAmountCents: number
  dayRule: DayRule
  dayValue: number
  nonBusinessDayPolicy: NonBusinessDayPolicy
  status: RecurrenceStatus
  remainingInstallments: number | null
  /** Empréstimo descontado em folha: vinculado ao crédito do salário. */
  payrollDeduction: boolean
  payrollSourceId: string | null
  /** O recebimento de que a parcela sai (o escolhido ou o salário principal). */
  payrollSource: { id: string; description: string } | null
  account: { name: string; type: string } | null
  paidOff: boolean
  monthStatus: MonthStatus | null
  linkedCount: number
  lastLinkedDate: IsoDate | null
  loan: {
    remaining: number | null
    remainingCents: number | null
    endMonth: string | null
  } | null
}

export interface RecurrenceTx {
  id: string
  date: IsoDate
  description: string
  amountCents: number
  account: { name: string }
}

export interface RecurrenceDetail {
  recurrence: Recurrence
  months: { month: string; amountCents: number }[]
  linked: { total: number; items: RecurrenceTx[] }
  suggestions: RecurrenceTx[]
}

export interface LinkCandidate extends RecurrenceTx {
  linkedTo: { id: string; description: string } | null
  /** Já vinculada a este recorrente. */
  linkedHere: boolean
}

export interface LinkCandidatesPage {
  total: number
  page: number
  pageSize: number
  items: LinkCandidate[]
}

export interface RecurrenceInput {
  description: string
  expectedAmountCents: number
  dayRule: DayRule
  dayValue: number
  nonBusinessDayPolicy: NonBusinessDayPolicy
}

export interface CreateRecurrenceInput extends RecurrenceInput {
  kind: RecurrenceKind
  direction: RecurrenceDirection
  accountId?: string
  remainingInstallments?: number
  payrollDeduction?: boolean
  payrollSourceId?: string
}

/** O PATCH é estrito: sem `direction`, que é a identidade do recorrente. */
export interface UpdateRecurrenceInput extends Partial<RecurrenceInput> {
  kind?: RecurrenceKind
  accountId?: string | null
  remainingInstallments?: number | null
  payrollDeduction?: boolean
  payrollSourceId?: string | null
  status?: 'CONFIRMED' | 'PAID_OFF'
}

export async function listRecurrences() {
  const { recurrences } = await api
    .get('recurrences')
    .json<{ recurrences: Recurrence[] }>()
  return recurrences
}

export async function getRecurrence(id: string) {
  return api.get(`recurrences/${id}`).json<RecurrenceDetail>()
}

export async function createRecurrence(input: CreateRecurrenceInput) {
  await api.post('recurrences', { json: input })
}

export async function updateRecurrence(
  id: string,
  input: UpdateRecurrenceInput,
) {
  await api.patch(`recurrences/${id}`, { json: input })
}

export async function dismissRecurrence(id: string) {
  await api.post(`recurrences/${id}/dismiss`)
}

export async function deleteRecurrence(id: string) {
  await api.delete(`recurrences/${id}`)
}

export async function listLinkCandidates(
  id: string,
  params: { search?: string; page?: number; linked?: boolean },
) {
  const searchParams = new URLSearchParams()
  if (params.search) searchParams.set('search', params.search)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.linked) searchParams.set('linked', 'true')
  return api
    .get(`recurrences/${id}/link-candidates`, { searchParams })
    .json<LinkCandidatesPage>()
}

/** Quantas o João escolheu e quantas parecidas vieram junto. */
export interface LinkResult {
  linked: number
  similar: number
}

export async function linkTransactions(id: string, transactionIds: string[]) {
  return api
    .post(`recurrences/${id}/links`, { json: { transactionIds } })
    .json<LinkResult>()
}

export async function unlinkTransaction(id: string, transactionId: string) {
  await api.delete(`recurrences/${id}/links/${transactionId}`)
}

export async function dismissLinkSuggestion(id: string, transactionId: string) {
  await api.post(`recurrences/${id}/link-dismissals`, {
    json: { transactionId },
  })
}
