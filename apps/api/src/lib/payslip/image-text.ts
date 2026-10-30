import porData from '@tesseract.js-data/por'
import sharp from 'sharp'
import { createWorker, OEM } from 'tesseract.js'

/** Bem acima de um print de tela; barra imagem que explodiria a memória ao abrir. */
const MAX_IMAGE_PIXELS = 25_000_000
/** Abaixo disso o OCR come vírgulas e troca dígitos; ampliar 2× resolve num print de 1088 px. */
const MIN_OCR_WIDTH = 2000

/** Largura e altura do cabeçalho IHDR, que vem logo depois da assinatura do PNG. */
function pngDimensions(png: Buffer) {
  if (png.length < 24) throw new Error('PNG sem cabeçalho')
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/** As linhas de texto de uma imagem, lidas por OCR em português. Lança se a imagem não abre. */
export async function readImageLines(png: Buffer) {
  // Conferido antes de abrir: o `limitInputPixels` do sharp fica como segunda barreira.
  const { width, height } = pngDimensions(png)
  if (width * height > MAX_IMAGE_PIXELS) throw new Error(`Imagem grande demais: ${width}x${height}`)

  const image = sharp(png, { limitInputPixels: MAX_IMAGE_PIXELS })

  const scale = width < MIN_OCR_WIDTH ? 2 : 1
  const prepared = await image
    .resize(width * scale)
    .grayscale()
    .png()
    .toBuffer()

  const worker = await createWorker(porData.code, OEM.LSTM_ONLY, {
    langPath: porData.langPath,
    gzip: porData.gzip,
    // Os dados de idioma já vêm do pacote; nada de baixar nem de gravar cache em disco.
    cacheMethod: 'none',
  })
  try {
    const { data } = await worker.recognize(prepared)
    return data.text
      .split('\n')
      .map((line) => line.normalize('NFC').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  } finally {
    await worker.terminate()
  }
}
