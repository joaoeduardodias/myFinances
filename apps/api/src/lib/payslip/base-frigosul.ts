import type { ParsedPayslip } from './parse'

type Line = ParsedPayslip['lines'][number]

const AMOUNT = String.raw`\d{1,3}(?:\.\d{3})*,\d{2}`
// Código e tipo só têm dígitos, mas o OCR de um print troca 0 por O e 1 por l ou I.
const CODE = String.raw`\d[\dOoIl]{0,3}`
const TYPE = String.raw`[0Oo][\dOoIl]`

/**
 * Uma verba: código, tipo, descrição, referência opcional e valor. As duas
 * colunas do holerite podem vir na mesma linha de texto, então a verba termina
 * onde começa a próxima (código + tipo) ou no fim da linha.
 */
const ENTRY = new RegExp(
  `(${CODE}) (${TYPE}) (.+?) (?:(${AMOUNT}) )?(${AMOUNT})(?= ${CODE} ${TYPE} |$)`,
  'g',
)

/** Tipo 01 é provento e 03 é desconto; o 04 (FGTS) é depósito do patrão e não sai do salário. */
const KIND_BY_TYPE: Record<string, Line['kind']> = { '01': 'EARNING', '03': 'DEDUCTION' }

function toDigits(text: string) {
  return text.replace(/[Oo]/g, '0').replace(/[Il]/g, '1')
}

function toCents(amount: string) {
  const [reais, centavos] = amount.replaceAll('.', '').split(',')
  return Number(reais) * 100 + Number(centavos)
}

function totalOf(text: string, label: string) {
  const match = text.match(new RegExp(`${label}:\\s*(${AMOUNT})`))
  return match ? toCents(match[1]) : null
}

function sumOf(lines: Line[], kind: Line['kind']) {
  return lines.filter((line) => line.kind === kind).reduce((sum, line) => sum + line.amountCents, 0)
}

/**
 * Holerite da Base Frigosul: verbas entre o cabeçalho "Cod. Tp Descrição" e a
 * linha "Totais:". Só reconhece quando as verbas somam os totais impressos e o
 * líquido fecha; qualquer diferença devolve `null` e o João lança à mão.
 */
export function parseBaseFrigosul(textLines: string[]): ParsedPayslip | null {
  const start = textLines.findIndex((line) => /Cod\. Tp Descrição/.test(line))
  const end = textLines.findIndex((line, index) => index > start && line.startsWith('Totais:'))
  if (start < 0 || end < 0) return null

  const entries = textLines.slice(start + 1, end).flatMap((line) => [...line.matchAll(ENTRY)])
  const lines = entries
    .map(([, , type, description, reference, amount]) => ({ type: toDigits(type), description, reference, amount }))
    .filter(({ type }) => type in KIND_BY_TYPE)
    .map(({ type, description, reference, amount }) => ({
      kind: KIND_BY_TYPE[type],
      description,
      reference: reference ?? null,
      amountCents: toCents(amount),
    }))
  // As colunas se intercalam linha a linha; os proventos vêm antes dos descontos.
  const ordered = [
    ...lines.filter((line) => line.kind === 'EARNING'),
    ...lines.filter((line) => line.kind === 'DEDUCTION'),
  ]

  const totals = textLines[end]
  const grossCents = totalOf(totals, 'Proventos')
  const deductionsCents = totalOf(totals, 'Descontos')
  const netCents = totalOf(totals, 'Líquido')
  if (grossCents === null || deductionsCents === null || netCents === null) return null

  const balanced =
    ordered.length > 0 &&
    sumOf(ordered, 'EARNING') === grossCents &&
    sumOf(ordered, 'DEDUCTION') === deductionsCents &&
    grossCents - deductionsCents === netCents
  return balanced ? { grossCents, netCents, lines: ordered } : null
}
