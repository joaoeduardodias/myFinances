const PREFIXES = ['pix enviado', 'pix recebido', 'compra cartao', 'pagamento']

/** Chave estável de uma descrição, para agrupar lançamentos do mesmo estabelecimento. */
export function descriptionKey(description: string): string {
  const key = description
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/parc\s*\d+\s*\/\s*\d+/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const prefix = PREFIXES.find((p) => key === p || key.startsWith(`${p} `))
  return prefix ? key.slice(prefix.length).trim() : key
}
