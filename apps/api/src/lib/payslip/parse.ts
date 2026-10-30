import { parseBaseFrigosul } from './base-frigosul'
import { detectPayslipFileType } from './file-type'
import { readImageLines } from './image-text'
import { readPdfLines } from './pdf-text'

export type ParsedPayslip = {
  grossCents: number
  netCents: number
  lines: {
    kind: 'EARNING' | 'DEDUCTION'
    description: string
    reference: string | null
    amountCents: number
  }[]
}

function defaultParseErrorLog(error: unknown) {
  console.warn('Holerite não abriu:', error instanceof Error ? error.message : String(error))
}

async function readLines(file: Buffer) {
  const type = detectPayslipFileType(file)
  if (type === 'pdf') return readPdfLines(file)
  if (type === 'png') return readImageLines(file)
  throw new Error('Holerite não é PDF nem PNG')
}

/**
 * Lê os valores de um holerite em PDF ou PNG (print, por OCR). Hoje só o layout
 * da Base Frigosul é conhecido; qualquer outro, ou um arquivo que não abre,
 * devolve `null` e o usuário lança as linhas à mão. O erro de abertura vai
 * para `onError`.
 */
export async function parsePayslip(
  file: Buffer,
  onError: (error: unknown) => void = defaultParseErrorLog,
): Promise<ParsedPayslip | null> {
  let lines: string[]
  try {
    lines = await readLines(file)
  } catch (error) {
    onError(error)
    return null
  }

  return parseBaseFrigosul(lines)
}
