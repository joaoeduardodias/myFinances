import { api } from './api'

export type Necessity = 'ESSENTIAL' | 'AVOIDABLE'
/** Marca de uma transação; emergência não existe como padrão de categoria. */
export type TransactionNecessity = Necessity | 'EMERGENCY'
export type SpendGroup =
  | 'essential'
  | 'avoidable'
  | 'emergency'
  | 'debt'
  | 'unclassified'

export interface AnalysisTotals {
  incomeCents: number
  essentialCents: number
  avoidableCents: number
  emergencyCents: number
  debtCents: number
  unclassifiedCents: number
  investedCents: number
}

export interface AnalysisExpense {
  id: string
  date: string
  description: string
  amountCents: number
  category: string | null
  necessity: TransactionNecessity | null
  accountName: string
  group: SpendGroup
}

export interface AnalysisCategory {
  category: string | null
  group: SpendGroup
  totalCents: number
  /** Sempre a média dos 12 meses, mesmo com o filtro de mês. */
  averageCents: number
  count: number
}

export interface Analysis {
  from: string
  to: string
  /** 'YYYY-MM' quando filtrado. */
  month: string | null
  months: (AnalysisTotals & { month: string })[]
  totals: AnalysisTotals
  categories: AnalysisCategory[]
  topExpenses: AnalysisExpense[]
  topAvoidable: AnalysisExpense[]
  /** `totalCents` é a soma dos débitos em módulo (positiva). */
  uncategorized: { count: number; totalCents: number }
}

export type AnalysisTransaction = AnalysisExpense & { categoryLocked: boolean }

export interface CategoryNecessity {
  category: string
  necessity: Necessity
  isDefault: boolean
}

export function getAnalysis(month?: string) {
  return api
    .get('analysis', { searchParams: month ? { month } : {} })
    .json<Analysis>()
}

export async function listAnalysisTransactions(p: {
  category: string | 'none'
  month?: string
}) {
  const searchParams: Record<string, string> = { category: p.category }
  if (p.month) searchParams.month = p.month
  const { transactions } = await api
    .get('analysis/transactions', { searchParams })
    .json<{ transactions: AnalysisTransaction[] }>()
  return transactions
}

export async function setTransactionNecessity(
  id: string,
  necessity: TransactionNecessity | null,
) {
  await api.patch(`transactions/${id}/necessity`, { json: { necessity } })
}

/** Com `applyToSimilar`, vale também para as iguais (texto do banco, valor e conta). */
export async function setTransactionDescription(
  id: string,
  description: string,
  applyToSimilar: boolean,
) {
  await api.patch(`transactions/${id}/description`, {
    json: { description, applyToSimilar },
  })
}

export interface TransactionSimilar {
  similar: number
  canSaveRecurrence: boolean
  recurrenceStatus: 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED' | null
}

export async function getTransactionSimilar(id: string) {
  return api.get(`transactions/${id}/similar`).json<TransactionSimilar>()
}

export async function saveTransactionRecurrence(id: string) {
  await api.post(`transactions/${id}/recurrence`)
}

export async function listCategoryNecessities() {
  const { categories } = await api
    .get('category-necessities')
    .json<{ categories: CategoryNecessity[] }>()
  return categories
}

export async function setCategoryNecessity(
  category: string,
  necessity: Necessity,
) {
  await api.put(`category-necessities/${encodeURIComponent(category)}`, {
    json: { necessity },
  })
}
