import type { IsoDate } from '@/lib/today'

type LinkTx = {
  id: string
  date: IsoDate
  amountCents: number
  descriptionKey: string
  isTransfer: boolean
  recurrenceId: string | null
}

/** Com o mesmo texto, o valor pode variar até isto (conta de luz); Pix genérico de outro valor, não. */
const KEY_AMOUNT_TOLERANCE = 0.25

/**
 * Transações que repetem as já vinculadas ao recorrente: o mesmo valor exato,
 * ou o mesmo texto do banco com valor perto de uma vinculada, em qualquer conta
 * (o boleto da Caixa e o débito do Nubank da mesma parcela). Uma por mês e nenhuma em mês já vinculado; no mesmo
 * mês, a que bate texto e valor vem antes. O "não é" do João fica de fora.
 */
export function similarTxIds(linked: LinkTx[], candidates: LinkTx[], dismissed: Set<string>): string[] {
  if (linked.length === 0) return []
  const sign = Math.sign(linked[0].amountCents)
  const keys = new Set(linked.map((t) => t.descriptionKey).filter(Boolean))
  const amounts = new Set(linked.map((t) => t.amountCents))
  const takenMonths = new Set(linked.map((t) => t.date.slice(0, 7)))
  const nearLinked = (t: LinkTx) =>
    linked.some(
      (l) => Math.abs(Math.abs(t.amountCents) - Math.abs(l.amountCents)) <= Math.abs(l.amountCents) * KEY_AMOUNT_TOLERANCE,
    )
  const sameText = (t: LinkTx) => keys.has(t.descriptionKey) && nearLinked(t)
  const score = (t: LinkTx) => (sameText(t) ? 1 : 0) + (amounts.has(t.amountCents) ? 1 : 0)

  const byMonth = new Map<string, LinkTx>()
  for (const t of candidates) {
    if (t.recurrenceId != null || t.isTransfer || Math.sign(t.amountCents) !== sign || dismissed.has(t.id)) continue
    if (score(t) === 0) continue
    const month = t.date.slice(0, 7)
    if (takenMonths.has(month)) continue
    const best = byMonth.get(month)
    if (!best || score(t) > score(best) || (score(t) === score(best) && t.date < best.date)) byMonth.set(month, t)
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => t.id)
}
