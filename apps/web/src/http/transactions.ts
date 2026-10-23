import type { Sort } from '@/lib/sort'
import type { IsoDate } from '@/lib/types'

import { api } from './api'

export type AccountType = 'BANK' | 'CREDIT' | 'WALLET'
export type TransactionKind = 'income' | 'expense' | 'transfer'
export type TransactionSortColumn =
  | 'date'
  | 'description'
  | 'account'
  | 'category'
  | 'amount'

export interface Account {
  id: string
  type: AccountType
  name: string
  number: string | null
  balanceCents: number
  closingDay: number | null
  dueDay: number | null
  connectorName: string | null
}

export interface Transaction {
  id: string
  date: IsoDate
  description: string
  amountCents: number
  category: string | null
  isTransfer: boolean
  source: 'PLUGGY' | 'MANUAL' | 'SYSTEM'
  account: { name: string; type: AccountType }
}

export interface TransactionsPage {
  transactions: Transaction[]
  page: number
  totalPages: number
}

export interface TransactionFilters {
  from: IsoDate
  to: IsoDate
  accountId?: string
  /** Nome da categoria, ou 'none' para as sem categoria. */
  category?: string
  kind?: TransactionKind
  page: number
  sort: Sort<TransactionSortColumn>
}

export interface ManualTransactionInput {
  date: IsoDate
  description: string
  amountCents: number
  category?: string
}

export async function listAccounts() {
  const { accounts } = await api.get('accounts').json<{ accounts: Account[] }>()
  return accounts
}

export async function listCategories() {
  const { categories } = await api
    .get('categories')
    .json<{ categories: string[] }>()
  return categories
}

export function listTransactions(filters: TransactionFilters) {
  const searchParams: Record<string, string | number> = {
    from: filters.from,
    to: filters.to,
    page: filters.page,
    sort: filters.sort.column,
    order: filters.sort.order,
  }
  if (filters.accountId) searchParams.accountId = filters.accountId
  if (filters.category) searchParams.category = filters.category
  if (filters.kind) searchParams.kind = filters.kind
  return api.get('transactions', { searchParams }).json<TransactionsPage>()
}

export async function setTransactionCategory(id: string, category: string) {
  await api.patch(`transactions/${id}/category`, { json: { category } })
}

export async function setTransactionTransfer(id: string, isTransfer: boolean) {
  await api.patch(`transactions/${id}/transfer`, { json: { isTransfer } })
}

export async function createManualTransaction(input: ManualTransactionInput) {
  await api.post('transactions', { json: input })
}

export async function deleteTransaction(id: string) {
  await api.delete(`transactions/${id}`)
}
