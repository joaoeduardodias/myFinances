import { env } from '@myfinances/env'

/** Data civil `YYYY-MM-DD`, sem hora nem fuso. */
export type IsoDate = string

/**
 * O dia de hoje no fuso do usuário, e não em UTC.
 *
 * `toISOString()` vira o dia às 21h em São Paulo: um lançamento feito à noite
 * cairia no dia seguinte. O locale `en-CA` é só um truque para o formato sair
 * já como `YYYY-MM-DD`.
 */
export function todayIso(
  timezone: string = env.TIMEZONE,
  now: Date = new Date(),
): IsoDate {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
}
