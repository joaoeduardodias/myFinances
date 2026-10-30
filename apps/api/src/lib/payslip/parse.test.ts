import { readFile } from 'node:fs/promises'
import { crc32 } from 'node:zlib'

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  baseFrigosulPayslipParsed,
  baseFrigosulPayslipPdf,
} from '@/test/payslip-sample'
import { buildTextPdf } from '@/test/pdf'

import { parsePayslip } from './parse'

const BASE_FRIGOSUL_PAYSLIP_PNG = new URL('../../test/fixtures/base-frigosul-payslip.png', import.meta.url)

describe('parsePayslip', () => {
  it('sem layout conhecido, devolve null', async () => {
    expect(await parsePayslip(Buffer.from('%PDF-1.4 qualquer'))).toBeNull()
  })

  it('lê o holerite da Base Frigosul de um PDF', async () => {
    expect(await parsePayslip(baseFrigosulPayslipPdf())).toEqual(baseFrigosulPayslipParsed)
  })

  it('PDF legível de outro layout devolve null sem acusar erro', async () => {
    const onError = vi.fn()
    const pdf = buildTextPdf([{ x: 20, y: 500, text: 'Recibo de aluguel 1.200,00' }])

    expect(await parsePayslip(pdf, onError)).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('PDF que não abre devolve null e passa o erro adiante', async () => {
    const onError = vi.fn()

    expect(await parsePayslip(Buffer.from('%PDF-1.4 qualquer'), onError)).toBeNull()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  describe('PNG', () => {
    const OCR_TIMEOUT = 30_000

    /** Só a assinatura e o cabeçalho de um PNG que diz ter `width` × `height`. */
    function pngHeader(width: number, height: number) {
      const ihdr = Buffer.alloc(13)
      ihdr.writeUInt32BE(width, 0)
      ihdr.writeUInt32BE(height, 4)
      ihdr.set([8, 0, 0, 0, 0], 8)
      const type = Buffer.from('IHDR')
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(Buffer.concat([type, ihdr])))
      const length = Buffer.alloc(4)
      length.writeUInt32BE(ihdr.length)
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), length, type, ihdr, crc])
    }

    it(
      'lê o holerite da Base Frigosul de um print',
      async () => {
        const parsed = await parsePayslip(await readFile(BASE_FRIGOSUL_PAYSLIP_PNG))

        expect(parsed).toMatchObject({ grossCents: 627024, netCents: 297000 })
        // O OCR pode comer espaços das descrições; os valores é que precisam bater.
        const values = (lines: typeof baseFrigosulPayslipParsed.lines | NonNullable<typeof parsed>['lines']) =>
          lines.map(({ kind, reference, amountCents }) => ({ kind, reference, amountCents }))
        expect(values(parsed?.lines ?? [])).toEqual(values(baseFrigosulPayslipParsed.lines))
        for (const line of parsed?.lines ?? []) expect(line.description).not.toBe('')
      },
      OCR_TIMEOUT,
    )

    it(
      'imagem sem holerite devolve null sem acusar erro',
      async () => {
        const onError = vi.fn()
        const blank = await sharp({
          create: { width: 400, height: 200, channels: 3, background: 'white' },
        })
          .png()
          .toBuffer()

        expect(await parsePayslip(blank, onError)).toBeNull()
        expect(onError).not.toHaveBeenCalled()
      },
      OCR_TIMEOUT,
    )

    it('PNG corrompido devolve null e passa o erro adiante', async () => {
      const onError = vi.fn()

      expect(await parsePayslip(Buffer.concat([pngHeader(10, 10), Buffer.from('lixo')]), onError)).toBeNull()
      expect(onError).toHaveBeenCalledOnce()
    })

    it('PNG enorme é recusado antes de abrir a imagem', async () => {
      const onError = vi.fn()

      expect(await parsePayslip(pngHeader(30_000, 30_000), onError)).toBeNull()
      expect(onError).toHaveBeenCalledOnce()
      expect(String(onError.mock.calls[0][0])).toMatch(/30000/)
    })
  })
})
