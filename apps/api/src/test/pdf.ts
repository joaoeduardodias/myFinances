/** Um texto numa posição da página, em pontos a partir do canto de baixo. */
export type PdfText = { x: number; y: number; text: string }

function escapePdfString(text: string) {
  return text.replace(/[\\()]/g, (char) => `\\${char}`)
}

/**
 * Monta um PDF mínimo e válido (Helvetica, WinAnsi) com os textos dados. Serve
 * para testar a leitura de holerite sem guardar um PDF real no repositório.
 */
export function buildTextPdf(texts: PdfText[]) {
  const content = texts
    .map(({ x, y, text }) => `BT /F1 8 Tf ${x} ${y} Td (${escapePdfString(text)}) Tj ET`)
    .join('\n')
  const contentBytes = Buffer.from(content, 'latin1')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream`,
  ]

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(body, 'latin1')
}
