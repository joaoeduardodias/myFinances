import fastifyMultipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authHeaders,
  buildTestApp,
  makePrismaMock,
  resetPrismaMocks,
  signToken,
  uuid,
} from '@/test/helpers'

const prismaMock = makePrismaMock()
const storageMock = vi.hoisted(() => ({
  MAX_PAYSLIP_BYTES: 5 * 1024 * 1024,
  payslipKey: vi.fn(),
  putFile: vi.fn(),
  getSignedFileUrl: vi.fn(),
  deleteFile: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/storage', () => storageMock)

const { multipartOptions } = await import('@/http/multipart')
const { uploadPayslip } = await import('./upload-payslip')
const { getPayslips } = await import('./get-payslips')
const { getPayslip } = await import('./get-payslip')
const { updatePayslipLines } = await import('./update-payslip-lines')
const { getPayslipFile } = await import('./get-payslip-file')
const { deletePayslip } = await import('./delete-payslip')
const { Prisma } = await import('@/prisma/generated/client')

const userA = uuid('user-a')
const payslipId = uuid('payslip')
const existingId = uuid('existing')
const txId = uuid('tx')

const BOUNDARY = '----myfinances-test'

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; content: Buffer }

function multipart(parts: Part[]) {
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`))
    if ('filename' in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            'Content-Type: application/pdf\r\n\r\n',
        ),
      )
      chunks.push(part.content, Buffer.from('\r\n'))
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`),
      )
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`))
  return Buffer.concat(chunks)
}

const pdf = Buffer.from('%PDF-1.4 holerite de outubro')

function uploadParts(overrides: { competence?: string; type?: string; file?: Buffer; filename?: string } = {}) {
  return [
    { name: 'competence', value: overrides.competence ?? '2026-10' },
    { name: 'type', value: overrides.type ?? 'MONTHLY' },
    { name: 'file', filename: overrides.filename ?? 'holerite.pdf', content: overrides.file ?? pdf },
  ]
}

async function withMultipart(app: FastifyInstance) {
  await app.register(fastifyMultipart, multipartOptions)
  await app.register(uploadPayslip)
}

async function upload(parts: Part[]) {
  const app = await buildTestApp(withMultipart)
  const token = await signToken(app, { sub: userA })
  return app.inject({
    method: 'POST',
    url: '/payslips',
    headers: { ...authHeaders(token), 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(parts),
  })
}

async function call(
  plugin: Parameters<typeof buildTestApp>[0],
  opts: { method: 'GET' | 'PUT' | 'DELETE'; url: string; body?: unknown },
) {
  const app = await buildTestApp(plugin)
  const token = await signToken(app, { sub: userA })
  return app.inject({
    method: opts.method,
    url: opts.url,
    headers: authHeaders(token),
    ...(opts.body ? { payload: opts.body as object } : {}),
  })
}

const row = {
  id: payslipId,
  competence: '2026-10',
  type: 'MONTHLY',
  status: 'UNRECOGNIZED',
  grossCents: null,
  netCents: null,
  fileName: 'holerite.pdf',
  createdAt: new Date('2026-10-22T12:00:00Z'),
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  prismaMock.$transaction.mockImplementation((cb: (p: unknown) => unknown) => cb(prismaMock))
  storageMock.payslipKey.mockReset().mockImplementation((userId: string) => `${userId}/payslips/abc.pdf`)
  storageMock.putFile.mockReset().mockResolvedValue(undefined)
  storageMock.getSignedFileUrl.mockReset()
  storageMock.deleteFile.mockReset().mockResolvedValue(undefined)
})

describe('POST /payslips', () => {
  it('PDF válido cria com UNRECOGNIZED e guarda sob o prefixo do usuário', async () => {
    prismaMock.payslip.findUnique.mockResolvedValue(null)
    prismaMock.payslip.create.mockResolvedValue(row)

    const res = await upload(uploadParts())

    expect(res.statusCode).toBe(201)
    expect(res.json().payslip).toMatchObject({ id: payslipId, status: 'UNRECOGNIZED' })
    const [key, body, type] = storageMock.putFile.mock.calls[0]
    expect(key.startsWith(userA)).toBe(true)
    expect(Buffer.compare(body, pdf)).toBe(0)
    expect(type).toBe('application/pdf')
    const data = prismaMock.payslip.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      userId: userA,
      competence: '2026-10',
      type: 'MONTHLY',
      status: 'UNRECOGNIZED',
      fileKey: key,
      fileName: 'holerite.pdf',
    })
    expect(data.fileSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('aceita os campos depois do arquivo', async () => {
    prismaMock.payslip.findUnique.mockResolvedValue(null)
    prismaMock.payslip.create.mockResolvedValue(row)

    const res = await upload([...uploadParts()].reverse())

    expect(res.statusCode).toBe(201)
  })

  it('texto renomeado para .pdf dá 400', async () => {
    const res = await upload(uploadParts({ file: Buffer.from('só um texto'), filename: 'falso.pdf' }))
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Envie um PDF')
    expect(storageMock.putFile).not.toHaveBeenCalled()
  })

  it('sem arquivo dá 400', async () => {
    const res = await upload(uploadParts().slice(0, 2))
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Envie um PDF')
  })

  it('arquivo de 6 MB dá 413', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.alloc(6 * 1024 * 1024, 'a')])
    const res = await upload(uploadParts({ file: big }))
    expect(res.statusCode).toBe(413)
    expect(res.json().message).toBe('O arquivo passa de 5 MB')
    expect(storageMock.putFile).not.toHaveBeenCalled()
  })

  it('o mesmo PDF duas vezes dá 409 com o payslipId', async () => {
    prismaMock.payslip.findUnique.mockResolvedValue({ id: existingId })

    const res = await upload(uploadParts())

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ payslipId: existingId })
    expect(res.json().message).toBeTruthy()
    expect(prismaMock.payslip.findUnique.mock.calls[0][0].where.userId_fileSha256.userId).toBe(userA)
    expect(storageMock.putFile).not.toHaveBeenCalled()
  })

  it('corrida no índice único (P2002) vira o mesmo 409 e apaga o arquivo', async () => {
    prismaMock.payslip.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: existingId })
    prismaMock.payslip.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7.5.0' }),
    )

    const res = await upload(uploadParts())

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ payslipId: existingId })
    expect(storageMock.deleteFile).toHaveBeenCalledWith(`${userA}/payslips/abc.pdf`, expect.any(Function))
  })

  it('falha no banco depois do upload apaga o arquivo', async () => {
    prismaMock.payslip.findUnique.mockResolvedValue(null)
    prismaMock.payslip.create.mockRejectedValue(new Error('banco caiu'))

    const res = await upload(uploadParts())

    expect(res.statusCode).toBe(500)
    expect(storageMock.deleteFile).toHaveBeenCalledWith(`${userA}/payslips/abc.pdf`, expect.any(Function))
  })

  it('competência 2026-13 dá 400', async () => {
    const res = await upload(uploadParts({ competence: '2026-13' }))
    expect(res.statusCode).toBe(400)
    expect(storageMock.putFile).not.toHaveBeenCalled()
  })

  it('tipo fora do enum dá 400', async () => {
    const res = await upload(uploadParts({ type: 'BONUS' }))
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /payslips', () => {
  it('lista do usuário por competência desc', async () => {
    prismaMock.payslip.findMany.mockResolvedValue([{ ...row, grossCents: 500000, netCents: 432050 }])

    const res = await call(getPayslips, { method: 'GET', url: '/payslips' })

    expect(res.statusCode).toBe(200)
    expect(res.json().payslips[0]).toMatchObject({
      type: 'MONTHLY',
      status: 'UNRECOGNIZED',
      grossCents: 500000,
      netCents: 432050,
    })
    const args = prismaMock.payslip.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ userId: userA })
    expect(args.orderBy[0]).toEqual({ competence: 'desc' })
  })
})

describe('GET /payslips/:id', () => {
  const line = {
    id: uuid('line'),
    kind: 'EARNING',
    description: 'Salário',
    reference: '30d',
    amountCents: 500000,
    position: 0,
  }

  it('acha o depósito de 4.321,00 em 2026-11-09 para líquido 4.320,50', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue({ ...row, netCents: 432050, lines: [line] })
    prismaMock.transaction.findMany.mockResolvedValue([
      { id: uuid('other'), date: new Date('2026-10-30T00:00:00Z'), amountCents: 432100, description: 'PIX' },
      { id: txId, date: new Date('2026-11-09T00:00:00Z'), amountCents: 432100, description: 'SALARIO' },
    ])

    const res = await call(getPayslip, { method: 'GET', url: `/payslips/${payslipId}` })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.lines).toHaveLength(1)
    expect(body.reconciliation).toEqual({
      matched: true,
      transaction: { id: txId, date: '2026-11-09', amountCents: 432100, description: 'SALARIO' },
    })
    const where = prismaMock.transaction.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      userId: userA,
      isTransfer: false,
      amountCents: { gte: 431950, lte: 432150 },
      date: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-11-15T00:00:00Z') },
    })
  })

  it('sem líquido não confere', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue({ ...row, lines: [] })

    const res = await call(getPayslip, { method: 'GET', url: `/payslips/${payslipId}` })

    expect(res.json().reconciliation).toEqual({ matched: false, transaction: null })
    expect(prismaMock.transaction.findMany).not.toHaveBeenCalled()
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue(null)
    const res = await call(getPayslip, { method: 'GET', url: `/payslips/${payslipId}` })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.payslip.findFirst.mock.calls[0][0].where).toEqual({ id: payslipId, userId: userA })
  })
})

describe('PUT /payslips/:id/lines', () => {
  const body = {
    grossCents: 500000,
    netCents: 432050,
    lines: [
      { kind: 'EARNING', description: 'Salário', reference: '30d', amountCents: 500000 },
      { kind: 'DEDUCTION', description: 'INSS', reference: null, amountCents: 67950 },
    ],
  }

  it('troca as linhas e grava MANUAL', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue({ id: payslipId })
    prismaMock.payslip.update.mockResolvedValue({ ...row, status: 'MANUAL', grossCents: 500000, netCents: 432050 })
    prismaMock.payslipLine.findMany.mockResolvedValue([])

    const res = await call(updatePayslipLines, { method: 'PUT', url: `/payslips/${payslipId}/lines`, body })

    expect(res.statusCode).toBe(200)
    expect(res.json().payslip.status).toBe('MANUAL')
    expect(prismaMock.payslipLine.deleteMany).toHaveBeenCalledWith({ where: { payslipId } })
    expect(prismaMock.payslipLine.createMany.mock.calls[0][0].data).toEqual([
      { payslipId, kind: 'EARNING', description: 'Salário', reference: '30d', amountCents: 500000, position: 0 },
      { payslipId, kind: 'DEDUCTION', description: 'INSS', reference: null, amountCents: 67950, position: 1 },
    ])
    expect(prismaMock.payslip.update.mock.calls[0][0].data).toEqual({
      status: 'MANUAL',
      grossCents: 500000,
      netCents: 432050,
    })
  })

  it('valor não positivo dá 400', async () => {
    const res = await call(updatePayslipLines, {
      method: 'PUT',
      url: `/payslips/${payslipId}/lines`,
      body: { ...body, lines: [{ ...body.lines[0], amountCents: 0 }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('de outro usuário dá 404', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue(null)
    const res = await call(updatePayslipLines, { method: 'PUT', url: `/payslips/${payslipId}/lines`, body })
    expect(res.statusCode).toBe(404)
    expect(prismaMock.payslipLine.deleteMany).not.toHaveBeenCalled()
  })
})

describe('GET /payslips/:id/file', () => {
  it('devolve a URL assinada com o nome guardado', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue({ fileKey: 'k', fileName: 'outubro.pdf' })
    storageMock.getSignedFileUrl.mockResolvedValue('https://r2/assinada')

    const res = await call(getPayslipFile, { method: 'GET', url: `/payslips/${payslipId}/file` })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ url: 'https://r2/assinada' })
    expect(storageMock.getSignedFileUrl).toHaveBeenCalledWith('k', 'outubro.pdf')
  })
})

describe('DELETE /payslips/:id', () => {
  it('apaga a linha e depois o arquivo', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue({ id: payslipId, fileKey: 'k' })
    const order: string[] = []
    prismaMock.payslip.delete.mockImplementation(async () => order.push('db'))
    storageMock.deleteFile.mockImplementation(async () => order.push('file'))

    const res = await call(deletePayslip, { method: 'DELETE', url: `/payslips/${payslipId}` })

    expect(res.statusCode).toBe(204)
    expect(prismaMock.payslip.delete).toHaveBeenCalledWith({ where: { id: payslipId } })
    expect(storageMock.deleteFile).toHaveBeenCalledWith('k', expect.any(Function))
    expect(order).toEqual(['db', 'file'])
  })

  it('de outro usuário dá 404 e não toca no bucket', async () => {
    prismaMock.payslip.findFirst.mockResolvedValue(null)
    const res = await call(deletePayslip, { method: 'DELETE', url: `/payslips/${payslipId}` })
    expect(res.statusCode).toBe(404)
    expect(storageMock.deleteFile).not.toHaveBeenCalled()
  })
})
