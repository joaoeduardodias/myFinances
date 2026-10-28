import type { AnalysisTotals } from '@/http/analysis'

/** Tudo o que saiu: os cinco grupos de gasto somados. */
export function spentCents(t: AnalysisTotals) {
  return (
    t.essentialCents +
    t.avoidableCents +
    t.emergencyCents +
    t.debtCents +
    t.unclassifiedCents
  )
}
