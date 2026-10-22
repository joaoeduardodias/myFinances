import type { IsoDate } from '@/lib/types'

const saoPauloDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Hoje em America/Sao_Paulo como 'YYYY-MM-DD'. */
export function todayInSaoPaulo(now = new Date()): IsoDate {
  return saoPauloDate.format(now)
}

/** Primeiro e último dia do mês corrente em America/Sao_Paulo. */
export function currentMonthRange(now = new Date()): {
  from: IsoDate
  to: IsoDate
} {
  const today = todayInSaoPaulo(now)
  const [year, month] = today.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const mm = String(month).padStart(2, '0')
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  }
}
