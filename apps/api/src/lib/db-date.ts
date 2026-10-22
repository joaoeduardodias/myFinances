import type { IsoDate } from '@/lib/today'

/** `YYYY-MM-DD` para a meia-noite UTC, que é como o Prisma grava `@db.Date`. */
export function toDbDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** Volta de `@db.Date` (meia-noite UTC) para `YYYY-MM-DD`. */
export function fromDbDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}
