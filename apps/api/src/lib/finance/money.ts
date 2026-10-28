/** Converte o valor decimal da Pluggy em centavos; o sinal vem do `type`, não do valor. */
export function toCents(value: number, type: 'CREDIT' | 'DEBIT'): number {
  const cents = Math.round(Math.abs(value) * 100)
  return type === 'DEBIT' ? -cents : cents
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** Valor absoluto em reais ("R$ 1.234,56"); o Intl põe um espaço sem quebra depois do "R$", aqui vira normal. */
export function formatBrl(cents: number): string {
  return brl.format(Math.abs(cents) / 100).replace(/\s/g, ' ')
}
