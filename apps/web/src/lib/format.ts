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
