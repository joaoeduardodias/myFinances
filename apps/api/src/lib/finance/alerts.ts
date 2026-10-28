import type { IsoDate } from '@/lib/today'

import { formatBrl } from './money'
import type { Projection } from './projection'

export type NewNotification = {
  kind: 'SPENDABLE_NEGATIVE' | 'CATEGORY_WARNING' | 'CATEGORY_EXCEEDED'
  dedupeKey: string | null
  title: string
  body: string
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

export function decideAlerts(input: {
  today: IsoDate
  projection: Pick<Projection, 'availableCents' | 'noIncomeConfigured' | 'nextIncome'>
  wasNegative: boolean
  limits: { category: string; limitCents: number }[]
  /** Gasto por categoria no mês de `today`. */
  spent: Map<string, number>
  existingKeys: Set<string>
}): { notifications: NewNotification[]; negative: boolean } {
  const { today, projection, wasNegative, limits, spent, existingKeys } = input
  const notifications: NewNotification[] = []

  // Sem renda configurada a projeção não diz nada: o estado fica como estava.
  let negative = wasNegative
  if (!projection.noIncomeConfigured) {
    negative = projection.availableCents < 0
    if (negative && !wasNegative && projection.nextIncome) {
      const [, month, day] = projection.nextIncome.date.split('-')
      notifications.push({
        kind: 'SPENDABLE_NEGATIVE',
        dedupeKey: null,
        title: 'Quanto posso gastar ficou negativo',
        body: `Faltam ${formatBrl(-projection.availableCents)} até ${projection.nextIncome.description} em ${day}/${month}.`,
      })
    }
  }

  const yearMonth = today.slice(0, 7)
  const monthName = MONTH_NAMES[Number(yearMonth.slice(5, 7)) - 1]
  for (const { category, limitCents } of limits) {
    const total = spent.get(category) ?? 0
    const key80 = `category:${category}:${yearMonth}:80`
    const key100 = `category:${category}:${yearMonth}:100`
    const body = `${formatBrl(total)} de ${formatBrl(limitCents)} em ${monthName}.`
    if (total >= limitCents) {
      if (!existingKeys.has(key100)) {
        notifications.push({
          kind: 'CATEGORY_EXCEEDED',
          dedupeKey: key100,
          title: `${category} atingiu o limite`,
          body,
        })
      }
    } else if (5 * total >= 4 * limitCents && !existingKeys.has(key80) && !existingKeys.has(key100)) {
      notifications.push({
        kind: 'CATEGORY_WARNING',
        dedupeKey: key80,
        title: `${category} chegou a 80% do limite`,
        body,
      })
    }
  }

  return { notifications, negative }
}
