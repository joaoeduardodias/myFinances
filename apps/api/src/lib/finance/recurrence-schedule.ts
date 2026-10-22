import type { IsoDate } from '@/lib/today'

import {
  adjustToBusinessDay,
  nthBusinessDay,
  type NonBusinessDayPolicy,
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

/** Uma data por mês, ordenadas, dentro de `[from, to]`. */
export function expectedDates(
  rule: RecurrenceRule,
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const dates: IsoDate[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const lastYear = Number(to.slice(0, 4))
  const lastMonth = Number(to.slice(5, 7))

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const date = dateInMonth(rule, year, month)
    if (date >= from && date <= to) dates.push(date)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return dates
}
