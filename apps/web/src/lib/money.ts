const WITH_THOUSANDS = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/
const PLAIN = /^\d+(,\d{1,2})?$/

/**
 * Valor digitado em reais ("20", "20,50", "1.234,56") em centavos inteiros,
 * ou `null` se for inválido ou zero. Lê os dígitos como texto: nada de float.
 */
export function parseReaisToCents(input: string): number | null {
  const text = input.replace(/^R\$/, '').trim()
  if (!WITH_THOUSANDS.test(text) && !PLAIN.test(text)) return null

  const [whole, fraction = ''] = text.replace(/\./g, '').split(',')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
