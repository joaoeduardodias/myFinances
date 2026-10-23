import type { IsoDate } from '@/lib/today'

import { addDays } from './business-days'

export const MATCH_WINDOW_DAYS = 3

export type MatchCandidate = {
  id: string
  accountId: string
  amountCents: number
  date: IsoDate
  createdAt: Date
}

/** Dias entre as duas datas, se estiverem dentro da janela; senão null. */
function distanceInDays(a: IsoDate, b: IsoDate): number | null {
  for (let days = 0; days <= MATCH_WINDOW_DAYS; days++) {
    if (addDays(a, days) === b || addDays(a, -days) === b) return days
  }
  return null
}

/**
 * O candidato que é a mesma transação que `target`, ou null. Mesma conta e
 * mesmo valor, até `MATCH_WINDOW_DAYS` de distância; ganha o mais próximo em
 * dias e, no empate, o `createdAt` mais antigo.
 */
export function pickEntryMatch(
  target: { accountId: string; amountCents: number; date: IsoDate },
  candidates: MatchCandidate[],
): string | null {
  let best: { id: string; days: number; createdAt: number } | null = null

  for (const candidate of candidates) {
    if (candidate.accountId !== target.accountId) continue
    if (candidate.amountCents !== target.amountCents) continue
    const days = distanceInDays(target.date, candidate.date)
    if (days === null) continue

    const createdAt = candidate.createdAt.getTime()
    if (
      best === null ||
      days < best.days ||
      (days === best.days && createdAt < best.createdAt)
    ) {
      best = { id: candidate.id, days, createdAt }
    }
  }

  return best?.id ?? null
}
