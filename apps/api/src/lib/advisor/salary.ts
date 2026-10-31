import type { IsoDate } from '@/lib/today'

export type IncomeRecurrence = {
  id?: string
  /** Sem conta, o texto vale em qualquer conta. */
  accountId: string | null
  descriptionKey: string
  expectedAmountCents: number
}
export type IncomeCredit = {
  accountId: string
  descriptionKey: string
  date: IsoDate
  amountCents: number
  recurrenceId?: string | null
}

/** O vínculo do João decide; sem vínculo, o mesmo texto (e a conta, se o recorrente tiver). */
function belongsTo(credit: IncomeCredit, rec: IncomeRecurrence): boolean {
  if (credit.recurrenceId != null) return credit.recurrenceId === rec.id
  return credit.descriptionKey === rec.descriptionKey && (rec.accountId === null || credit.accountId === rec.accountId)
}

/**
 * Salário recebido por mês (`YYYY-MM`): para cada recorrência de renda, o
 * crédito do mês dela (ver `belongsTo`) mais próximo do valor esperado.
 * Crédito extra com a mesma descrição (13º, férias) não entra.
 */
export function salaryByMonth(credits: IncomeCredit[], recurrences: IncomeRecurrence[]): Map<string, number> {
  const byMonth = new Map<string, IncomeCredit[]>()
  for (const credit of credits) {
    const month = credit.date.slice(0, 7)
    byMonth.set(month, [...(byMonth.get(month) ?? []), credit])
  }

  const result = new Map<string, number>()
  for (const [month, monthCredits] of byMonth) {
    const used = new Set<IncomeCredit>()
    let total = 0
    for (const rec of recurrences) {
      const match = monthCredits
        .filter((c) => !used.has(c) && belongsTo(c, rec))
        .sort(
          (a, b) =>
            Math.abs(a.amountCents - rec.expectedAmountCents) - Math.abs(b.amountCents - rec.expectedAmountCents),
        )[0]
      if (!match) continue
      used.add(match)
      total += match.amountCents
    }
    if (total > 0) result.set(month, total)
  }
  return result
}
