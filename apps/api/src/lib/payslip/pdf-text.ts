import { extractTextItems, getDocumentProxy } from 'unpdf'

/** Textos com até essa diferença de altura (em pontos) estão na mesma linha. */
const SAME_LINE_TOLERANCE = 2
/** Pedaços mais próximos que isso (em pontos) são a mesma palavra. */
const SAME_WORD_GAP = 1

type TextItem = Awaited<ReturnType<typeof extractTextItems>>['items'][number][number]

/** Junta os textos de uma página em linhas, de cima para baixo e da esquerda para a direita. */
function toTextLines(items: TextItem[]) {
  const rows: TextItem[][] = []
  const byPosition = items
    .filter((item) => item.str.trim())
    .sort((a, b) => b.y - a.y || a.x - b.x)
  for (const item of byPosition) {
    const row = rows.at(-1)
    if (row && Math.abs(row[0].y - item.y) <= SAME_LINE_TOLERANCE) row.push(item)
    else rows.push([item])
  }

  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.x - b.x)
    const text = sorted
      .map((item, index) => {
        const previous = sorted[index - 1]
        const glued = previous && item.x - (previous.x + previous.width) < SAME_WORD_GAP
        return glued ? item.str : ` ${item.str}`
      })
      .join('')
    return text.normalize('NFC').replace(/\s+/g, ' ').trim()
  })
}

/** As linhas de texto de todas as páginas do PDF. Lança se o PDF não abre. */
export async function readPdfLines(pdf: Buffer) {
  // Cópia: o pdf.js pode tomar posse do buffer, e quem chamou ainda vai gravá-lo.
  // `verbosity: 0` cala os avisos do pdf.js; a falha de verdade vem como exceção.
  const document = await getDocumentProxy(new Uint8Array(pdf), { verbosity: 0 })
  const { items } = await extractTextItems(document)
  return items.flatMap(toTextLines)
}
