import { api } from './api'

export type Necessity = 'ESSENTIAL' | 'AVOIDABLE'
export type SpendGroup = 'essential' | 'avoidable' | 'debt' | 'unclassified'

export interface AnalysisTotals {
  incomeCents: number
  essentialCents: number
  avoidableCents: number
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
  necessity: Necessity | null
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
  necessity: Necessity | null,
) {
  await api.patch(`transactions/${id}/necessity`, { json: { necessity } })
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
