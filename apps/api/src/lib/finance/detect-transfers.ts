import type { IsoDate } from '@/lib/today'

const DAY_MS = 86_400_000
const MAX_DAYS_APART = 3

export type TransferCandidate = {
  id: string
  accountId: string
  accountType: 'BANK' | 'CREDIT' | 'WALLET'
  date: IsoDate
  amountCents: number
  isTransfer: boolean
  transferLocked: boolean
}

export function isBillPaymentDescription(description: string): boolean {
  return /pag(amento|to)?\.?\s*(de\s*)?fatura/i.test(description)
}

/**
 * Entrada no cartão que é pagamento de fatura. O emissor costuma escrever só
 * "PAGAMENTO RECEBIDO", sem "fatura"; num cartão, uma entrada assim não é estorno.
 */
export function isCardPaymentCreditDescription(description: string): boolean {
  return isBillPaymentDescription(description) || /\bpag(amento|to)\b/i.test(description)
}

export function isWithdrawalDescription(description: string): boolean {
  return /\bsaque\b/i.test(description)
}

function daysApart(a: IsoDate, b: IsoDate): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS
}

/**
 * Pares `[saída, entrada]` de transferência entre contas do usuário: valores
 * opostos e iguais, contas diferentes, até 3 dias de distância. Cada transação
 * entra em no máximo um par; ganha a data mais próxima e, no empate, o menor id.
 *
 * Só banco → banco e banco → cartão (pagamento de fatura). Saída no cartão é
 * compra, e a Carteira só recebe pelo saque; parear qualquer um deles tiraria
 * um gasto de verdade das contas.
 *
 * Quem chega aqui ainda não tem par: a que já é transferência (pagamento de
 * fatura marcado sozinho) continua candidata, a travada pelo usuário não.
 */
export function detectTransferPairs(txs: TransferCandidate[]): [string, string][] {
  const free = txs.filter((t) => !t.transferLocked && t.amountCents !== 0)
  const outflows = free.filter((t) => t.amountCents < 0 && t.accountType === 'BANK')
  const inflows = free.filter(
    (t) => t.amountCents > 0 && (t.accountType === 'BANK' || t.accountType === 'CREDIT'),
  )

  const candidates: { out: string; in: string; days: number }[] = []
  for (const out of outflows) {
    for (const inflow of inflows) {
      if (inflow.accountId === out.accountId) continue
      if (inflow.amountCents !== -out.amountCents) continue
      const days = daysApart(out.date, inflow.date)
      if (days <= MAX_DAYS_APART) candidates.push({ out: out.id, in: inflow.id, days })
    }
  }

  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  candidates.sort((a, b) => a.days - b.days || byId(a.out, b.out) || byId(a.in, b.in))

  const used = new Set<string>()
  const pairs: [string, string][] = []
  for (const c of candidates) {
    if (used.has(c.out) || used.has(c.in)) continue
    used.add(c.out)
    used.add(c.in)
    pairs.push([c.out, c.in])
  }
  return pairs
}
