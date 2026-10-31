import type { IsoDate } from '@/lib/today'

import { addDays } from './business-days'
import { findOccurrenceTx, type ProjectionRecurrence, type ProjectionTx } from './projection'
import { expectedDates } from './recurrence-schedule'

const SALARY = /\bsalario\b/
/** A ocorrência casa até 5 dias depois da data esperada. */
const MATCH_MARGIN_DAYS = 5

type Income = { id: string; descriptionKey: string; expectedAmountCents: number }

/**
 * Recebimento de que a parcela em folha é descontada: o escolhido ou, sem ele
 * (ou se deixou de ser recebimento), o salário de maior valor — o vale tem a
 * mesma descrição, mas é menor.
 */
export function pickPayrollSource<T extends Income>(sourceId: string | null, incomes: T[]): T | null {
  const chosen = sourceId ? incomes.find((i) => i.id === sourceId) : undefined
  if (chosen) return chosen
  const salaries = incomes.filter((i) => SALARY.test(i.descriptionKey))
  const pool = salaries.length > 0 ? salaries : incomes
  return pool.reduce<T | null>((best, i) => (best && best.expectedAmountCents >= i.expectedAmountCents ? best : i), null)
}

/** Créditos que cumprem as ocorrências do salário desde `from`: um por ocorrência, como na projeção. */
export function payrollCreditIds<T extends ProjectionTx & { id: string }>(
  source: ProjectionRecurrence,
  txs: T[],
  from: IsoDate,
  today: IsoDate,
): string[] {
  let available = txs.filter((t) => t.date >= from)
  const ids: string[] = []
  for (const date of expectedDates(source, from, addDays(today, MATCH_MARGIN_DAYS))) {
    const tx = findOccurrenceTx(source, date, available) as T | undefined
    if (!tx) continue
    ids.push(tx.id)
    available = available.filter((t) => t !== tx)
  }
  return ids
}
