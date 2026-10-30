import { describe, expect, it } from 'vitest'

import { detectPayslipFileType } from './file-type'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('detectPayslipFileType', () => {
  it('reconhece PDF pelos bytes iniciais', () => {
    expect(detectPayslipFileType(Buffer.from('%PDF-1.4 qualquer'))).toBe('pdf')
  })

  it('reconhece PNG pela assinatura', () => {
    expect(detectPayslipFileType(Buffer.concat([PNG_SIGNATURE, Buffer.from('resto')]))).toBe('png')
  })

  it('não confia no nome: texto, JPEG e assinatura cortada não passam', () => {
    expect(detectPayslipFileType(Buffer.from('só um texto'))).toBeNull()
    expect(detectPayslipFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
    expect(detectPayslipFileType(PNG_SIGNATURE.subarray(0, 4))).toBeNull()
    expect(detectPayslipFileType(Buffer.alloc(0))).toBeNull()
  })
})
