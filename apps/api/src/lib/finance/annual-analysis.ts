import type { IsoDate } from '@/lib/today'

import { type Category, DEFAULT_GROUP, type Necessity } from './categories'
import type { AccountType } from './projection'

const ANALYSIS_MONTHS = 12
const TOP_LIMIT = 10

export type AnalysisTx = {
  id: string
  date: IsoDate
  description: string
  amountCents: number
  category: string | null
  necessity: Necessity | null
  isTransfer: boolean
  accountType: AccountType
  accountName: string
}

export type SpendGroup = 'essential' | 'avoidable' | 'debt' | 'unclassified'

export type AnalysisMonth = {
  /** `YYYY-MM` */
  month: string
  incomeCents: number
  essentialCents: number
  avoidableCents: number
  debtCents: number
  unclassifiedCents: number
  investedCents: number
}

export type CategoryTotal = {
  category: string | null
  group: SpendGroup
  totalCents: number
  averageCents: number
  count: number
}

export type AnalysisExpense = Omit<AnalysisTx, 'isTransfer' | 'accountType'> & { group: SpendGroup }

export type Analysis = {
  from: IsoDate
  to: IsoDate
  month: string | null
  /** Sempre os 12 meses, mais antigo primeiro. */
  months: AnalysisMonth[]
  /** Do período, ou do mês filtrado. */
  totals: Omit<AnalysisMonth, 'month'>
  /** Gastos, maior total primeiro. */
  categories: CategoryTotal[]
  topExpenses: AnalysisExpense[]
  topAvoidable: AnalysisExpense[]
  /** Débitos sem categoria; `totalCents` positivo. */
  uncategorized: { count: number; totalCents: number }
}

export type Classification =
  | { kind: 'income' | 'investment' | 'ignored' }
  | { kind: 'spend'; group: SpendGroup }

const INCOME_CATEGORIES = new Set<string | null>([null, 'Outros', 'Salário', 'Outras receitas'])

/** Grupo de gasto da categoria, com a troca de padrão do usuário; `null` se não é de gasto. */
function spendGroupOf(category: string | null, overrides: Map<string, Necessity>): SpendGroup | null {
  if (category === null) return null
  const group = DEFAULT_GROUP[category as Category]
  if (group === 'debt') return 'debt'
  if (group !== 'essential' && group !== 'avoidable') return null
  const necessity = overrides.get(category)
  if (necessity) return necessity === 'ESSENTIAL' ? 'essential' : 'avoidable'
  return group
}

export function classify(tx: AnalysisTx, overrides: Map<string, Necessity>): Classification {
  if (tx.isTransfer) return { kind: 'ignored' }
  if (tx.category === 'Investimentos') return { kind: tx.amountCents < 0 ? 'investment' : 'ignored' }

  const group = spendGroupOf(tx.category, overrides)
  if (tx.amountCents > 0) {
    // Crédito com categoria de gasto é estorno/devolução: abate o grupo.
    if (group) return { kind: 'spend', group }
    if (tx.accountType !== 'CREDIT' && INCOME_CATEGORIES.has(tx.category)) return { kind: 'income' }
    return { kind: 'ignored' }
  }

  if (tx.necessity) return { kind: 'spend', group: tx.necessity === 'ESSENTIAL' ? 'essential' : 'avoidable' }
  return { kind: 'spend', group: group ?? 'unclassified' }
}

function emptyTotals(): Omit<AnalysisMonth, 'month'> {
  return { incomeCents: 0, essentialCents: 0, avoidableCents: 0, debtCents: 0, unclassifiedCents: 0, investedCents: 0 }
}

const GROUP_FIELD: Record<SpendGroup, keyof Omit<AnalysisMonth, 'month'>> = {
  essential: 'essentialCents',
  avoidable: 'avoidableCents',
  debt: 'debtCents',
  unclassified: 'unclassifiedCents',
}

function addTo(bucket: Omit<AnalysisMonth, 'month'>, tx: AnalysisTx, c: Classification): void {
  if (c.kind === 'income') bucket.incomeCents += tx.amountCents
  else if (c.kind === 'investment') bucket.investedCents -= tx.amountCents
  else if (c.kind === 'spend') bucket[GROUP_FIELD[c.group]] -= tx.amountCents
}

function toExpense(tx: AnalysisTx, group: SpendGroup): AnalysisExpense {
  const { isTransfer: _t, accountType: _a, ...rest } = tx
  return { ...rest, group }
}

/**
 * Análise dos últimos 12 meses até hoje: entradas, gastos por grupo
 * (essencial, evitável, dívida, sem classificação) e investido, mês a mês e
 * por categoria. `month` recorta tudo menos `months` e a média das categorias,
 * que segue sendo dos 12 meses para comparar o mês com ela.
 */
export function annualAnalysis(input: {
  today: IsoDate
  month?: string
  transactions: AnalysisTx[]
  overrides: Map<string, Necessity>
  /** Data da primeira transação do usuário; sem ela, a mais antiga de `transactions`. */
  firstDate?: IsoDate
}): Analysis {
  const { today, overrides } = input
  const [year, month] = today.split('-').map(Number)
  const months: AnalysisMonth[] = Array.from({ length: ANALYSIS_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(year, month - ANALYSIS_MONTHS + i, 1))
    return { month: d.toISOString().slice(0, 7), ...emptyTotals() }
  })
  const byMonth = new Map(months.map((m) => [m.month, m]))
  const from = `${months[0].month}-01`
  const filter = input.month ?? null

  const totals = emptyTotals()
  const categories = new Map<string | null, CategoryTotal>()
  const expenses: AnalysisExpense[] = []
  const uncategorized = { count: 0, totalCents: 0 }

  for (const tx of input.transactions) {
    if (tx.date < from || tx.date > today) continue
    const c = classify(tx, overrides)
    const key = tx.date.slice(0, 7)
    const bucket = byMonth.get(key)
    if (bucket) addTo(bucket, tx, c)

    let cat: CategoryTotal | undefined
    if (c.kind === 'spend') {
      cat = categories.get(tx.category)
      if (!cat) {
        const group = spendGroupOf(tx.category, overrides) ?? 'unclassified'
        cat = { category: tx.category, group, totalCents: 0, averageCents: 0, count: 0 }
        categories.set(tx.category, cat)
      }
      // A média usa os 12 meses; aqui acumula a soma e divide no fim.
      cat.averageCents -= tx.amountCents
    }

    if (filter && key !== filter) continue
    addTo(totals, tx, c)
    if (cat) {
      cat.totalCents -= tx.amountCents
      cat.count += 1
    }
    if (tx.isTransfer || tx.amountCents >= 0) continue
    if (tx.category === null) {
      uncategorized.count += 1
      uncategorized.totalCents -= tx.amountCents
    }
    if (c.kind === 'spend') expenses.push(toExpense(tx, c.group))
  }

  const firstDate =
    input.firstDate ?? input.transactions.reduce<IsoDate | null>((min, tx) => (min === null || tx.date < min ? tx.date : min), null)
  const firstIndex = firstDate === null || firstDate < from ? 0 : months.findIndex((m) => m.month === firstDate.slice(0, 7))
  const divisor = Math.max(1, firstIndex < 0 ? 1 : ANALYSIS_MONTHS - firstIndex)

  const categoryList = [...categories.values()]
    .filter((c) => c.count > 0)
    .map((c) => ({ ...c, averageCents: Math.round(c.averageCents / divisor) }))
    .sort((a, b) => b.totalCents - a.totalCents)

  expenses.sort((a, b) => a.amountCents - b.amountCents)

  return {
    from,
    to: today,
    month: filter,
    months,
    totals,
    categories: categoryList,
    topExpenses: expenses.slice(0, TOP_LIMIT),
    topAvoidable: expenses.filter((e) => e.group === 'avoidable').slice(0, TOP_LIMIT),
    uncategorized,
  }
}
