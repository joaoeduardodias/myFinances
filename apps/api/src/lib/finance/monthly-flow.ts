import type { IsoDate } from '@/lib/today'

import type { AccountType, ProjectionTx } from './projection'

const FLOW_MONTHS = 12

export type FlowMonth = {
  /** `YYYY-MM` */
  month: string
  creditCents: number
  debitCents: number
  cardCents: number
}

/**
 * Entradas e saídas das contas (Carteira junto) e compras no cartão, mês a mês,
 * nos últimos 12 meses até o de hoje. Transferências ficam fora: pagamento de
 * fatura e saque não são gasto. Estorno no cartão não abate as compras.
 */
export function monthlyFlow(input: {
  today: IsoDate
  accounts: { id: string; type: AccountType }[]
  transactions: ProjectionTx[]
}): FlowMonth[] {
  const [year, month] = input.today.split('-').map(Number)
  const months: FlowMonth[] = Array.from({ length: FLOW_MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(year, month - FLOW_MONTHS + i, 1))
    return { month: d.toISOString().slice(0, 7), creditCents: 0, debitCents: 0, cardCents: 0 }
  })
  const byMonth = new Map(months.map((m) => [m.month, m]))
  const typeOf = new Map(input.accounts.map((a) => [a.id, a.type]))

  for (const tx of input.transactions) {
    if (tx.isTransfer || tx.date > input.today) continue
    const bucket = byMonth.get(tx.date.slice(0, 7))
    if (!bucket) continue
    if (typeOf.get(tx.accountId) === 'CREDIT') {
      if (tx.amountCents < 0) bucket.cardCents -= tx.amountCents
    } else if (tx.amountCents > 0) {
      bucket.creditCents += tx.amountCents
    } else {
      bucket.debitCents -= tx.amountCents
    }
  }
  return months
}
