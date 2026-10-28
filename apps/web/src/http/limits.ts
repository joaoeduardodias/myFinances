import { api } from './api'

export type LimitStatus = 'NEW' | 'ACTIVE' | 'DECLINED'

export interface CategoryLimit {
  category: string
  status: LimitStatus
  limitCents: number | null
  proposedCents: number | null
  spentCents: number
}

export interface CategoryLimits {
  /** Mês de referência, `YYYY-MM`. */
  month: string
  limits: CategoryLimit[]
}

const path = (category: string) =>
  `category-limits/${encodeURIComponent(category)}`

export function getCategoryLimits() {
  return api.get('category-limits').json<CategoryLimits>()
}

export async function setCategoryLimit(category: string, limitCents: number) {
  await api.put(path(category), { json: { limitCents } })
}

/** Remove o limite ativo ou recusa a proposta (mesma rota). */
export async function declineCategoryLimit(category: string) {
  await api.delete(path(category))
}
