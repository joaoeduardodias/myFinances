import type { IsoDate } from '@/lib/types'

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Centavos inteiros em reais. O Intl separa "R$" do número com NBSP; aqui vira espaço normal. */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/\u00a0/g, ' ')
}

/** 'YYYY-MM-DD' em 'DD/MM/YYYY', sem passar por Date: o fuso não desloca o dia. */
export function formatDate(iso: IsoDate): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

const saoPauloDate = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** Instante ISO (com hora) no dia que ele é em São Paulo, como 'DD/MM/YYYY'. */
export function formatDateTimeToDate(iso: string): string {
  return saoPauloDate.format(new Date(iso))
}
