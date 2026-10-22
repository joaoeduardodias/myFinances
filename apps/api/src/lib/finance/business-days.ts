import type { IsoDate } from '@/lib/today'

export type NonBusinessDayPolicy = 'ANTICIPATE' | 'POSTPONE' | 'KEEP'

const DAY_MS = 86_400_000

// Toda conta de data é feita em UTC sobre `YYYY-MM-DD`, para não depender do
// fuso da máquina.
function toUtc(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

function toIso(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toIso(new Date(toUtc(date).getTime() + days * DAY_MS))
}

/** Páscoa pelo algoritmo de Meeus/Butcher. */
function easter(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const FIXED_HOLIDAYS = [
  '01-01',
  '04-21',
  '05-01',
  '09-07',
  '10-12',
  '11-02',
  '11-15',
  '11-20',
  '12-25',
]

/**
 * Calendário bancário: o dinheiro cai em dia de banco, então Carnaval e
 * Corpus Christi contam como feriado mesmo sendo ponto facultativo.
 */
export function bankHolidays(year: number): Set<IsoDate> {
  const easterDate = easter(year)
  return new Set([
    ...FIXED_HOLIDAYS.map((day) => `${year}-${day}`),
    addDays(easterDate, -48), // segunda de Carnaval
    addDays(easterDate, -47), // terça de Carnaval
    addDays(easterDate, -2), // Sexta-feira Santa
    addDays(easterDate, 60), // Corpus Christi
  ])
}

export function isBusinessDay(date: IsoDate): boolean {
  const weekday = toUtc(date).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !bankHolidays(Number(date.slice(0, 4))).has(date)
}

/**
 * `month` de 1 a 12. Lança `RangeError` se o mês não tiver `n` dias úteis
 * (`n` vem do usuário em `Recurrence.dayValue`).
 */
export function nthBusinessDay(year: number, month: number, n: number): IsoDate {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Dia útil inválido: ${n}`)
  }
  const prefix = `${year}-${String(month).padStart(2, '0')}`
  let date: IsoDate = `${prefix}-01`
  let count = 0
  while (date.startsWith(prefix)) {
    if (isBusinessDay(date)) {
      count += 1
      if (count === n) return date
    }
    date = addDays(date, 1)
  }
  throw new RangeError(`${prefix} tem só ${count} dias úteis, pedido o ${n}º`)
}

export function adjustToBusinessDay(
  date: IsoDate,
  policy: NonBusinessDayPolicy,
): IsoDate {
  if (policy === 'KEEP') return date
  const step = policy === 'ANTICIPATE' ? -1 : 1
  let adjusted = date
  while (!isBusinessDay(adjusted)) adjusted = addDays(adjusted, step)
  return adjusted
}
