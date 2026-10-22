import type { FastifyMultipartOptions } from '@fastify/multipart'

import { MAX_PAYSLIP_BYTES } from '@/lib/storage'

// Um arquivo só, e não maior que um holerite pode ser. Passar disso faz o
// `toBuffer()` lançar `FST_REQ_FILE_TOO_LARGE` (413 no `errorHandler`).
// Os campos de texto (competência e tipo) são poucos e curtos: o limite
// impede que um formulário enorme encha a memória antes da validação.
export const multipartOptions: FastifyMultipartOptions = {
  limits: { fileSize: MAX_PAYSLIP_BYTES, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
}
