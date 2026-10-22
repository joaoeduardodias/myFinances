import type { IsoDate } from '@/lib/today'

import {
  adjustToBusinessDay,
  type NonBusinessDayPolicy,
  nthBusinessDay,
} from './business-days'

export type RecurrenceRule = {
  dayRule: 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'
  dayValue: number
  nonBusinessDayPolicy: NonBusinessDayPolicy
}

function dateInMonth(rule: RecurrenceRule, year: number, month: number): IsoDate {
  // NTH_BUSINESS_DAY já cai em dia útil, então a política não se aplica.
  if (rule.dayRule === 'NTH_BUSINESS_DAY') {
    return nthBusinessDay(year, month, rule.dayValue)
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(rule.dayValue, lastDay)
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return adjustToBusinessDay(date, rule.nonBusinessDayPolicy)
}

/**
 * Uma data por mês, ordenadas, dentro de `[from, to]`.
 *
 * Gera candidatas também do mês anterior a `from` e do seguinte a `to`: a
 * política de dia útil pode puxar ou empurrar a data para dentro do intervalo.
 */
export function expectedDates(
  rule: RecurrenceRule,
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const dates = new Set<IsoDate>()
  const year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7)) - 1
  const lastYear = Number(to.slice(0, 4))
  const lastMonth = Number(to.slice(5, 7)) + 1

  // Meses fora de 1-12 são normalizados na comparação abaixo.
  while (year * 12 + month <= lastYear * 12 + lastMonth) {
    const normalized = year * 12 + (month - 1)
    const date = dateInMonth(
      rule,
      Math.floor(normalized / 12),
      (normalized % 12) + 1,
    )
    if (date >= from && date <= to) dates.add(date)
    month += 1
  }
  return [...dates].sort()
}
