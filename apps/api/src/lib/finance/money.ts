/** Converte o valor decimal da Pluggy em centavos; o sinal vem do `type`, não do valor. */
export function toCents(value: number, type: 'CREDIT' | 'DEBIT'): number {
  const cents = Math.round(Math.abs(value) * 100)
  return type === 'DEBIT' ? -cents : cents
}
