import { createHash } from 'node:crypto'

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { parsePayslip } from '@/lib/payslip/parse'
import { prisma } from '@/lib/prisma'
import { isUniqueViolation } from '@/lib/prisma-errors'
import { deleteFile, payslipKey, putFile } from '@/lib/storage'

import { BadRequestError } from '../_errors/bad-request-error'
import { ConflictError } from '../_errors/conflict-error'
import { competence, payslipSchema, payslipSelect, payslipType, serializePayslip } from './payslip-schema'

const fieldsSchema = z.object({ competence, type: payslipType })

const NOT_A_PDF = 'Envie um PDF'
const DUPLICATE = 'Este holerite já foi enviado.'
const FALLBACK_FILE_NAME = 'holerite.pdf'
const MAX_FILE_NAME_LENGTH = 200

/**
 * Lê o formulário inteiro. A ordem das partes não é garantida, então os campos
 * podem vir antes ou depois do arquivo; o arquivo é lido para a memória na hora
 * (o `request.parts()` exige consumir cada arquivo antes de seguir).
 */
async function readUpload(request: FastifyRequest) {
  const fields: Record<string, string> = {}
  let file: { buffer: Buffer; fileName: string } | null = null

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      // `toBuffer()` lança `FST_REQ_FILE_TOO_LARGE` ao passar do limite.
      const buffer = await part.toBuffer()
      // Por garantia: um arquivo cortado no limite nunca segue adiante.
      if (part.file.truncated) {
        throw new request.server.multipartErrors.RequestFileTooLargeError()
      }
      if (part.fieldname === 'file') {
        file = { buffer, fileName: part.filename.trim().slice(0, MAX_FILE_NAME_LENGTH) || FALLBACK_FILE_NAME }
      }
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value
    }
  }

  return { fields, file }
}

export async function uploadPayslip(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/payslips',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Upload a payslip PDF (multipart: file, competence, type).',
          operationId: 'uploadPayslip',
          security: [{ bearerAuth: [] }],
          consumes: ['multipart/form-data'],
          response: { 201: z.object({ payslip: payslipSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { fields, file } = await readUpload(request)

        const { competence, type } = fieldsSchema.parse(fields)
        if (!file?.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw new BadRequestError(NOT_A_PDF)
        }

        const fileSha256 = createHash('sha256').update(file.buffer).digest('hex')
        const findDuplicate = () =>
          prisma.payslip.findUnique({
            select: { id: true },
            where: { userId_fileSha256: { userId, fileSha256 } },
          })

        const duplicate = await findDuplicate()
        if (duplicate) throw new ConflictError(DUPLICATE, { payslipId: duplicate.id })

        const parsed = parsePayslip(file.buffer)
        const fileKey = payslipKey(userId)
        await putFile(fileKey, file.buffer, 'application/pdf')

        try {
          const payslip = await prisma.payslip.create({
            select: payslipSelect,
            data: {
              userId,
              competence,
              type,
              status: parsed ? 'RECOGNIZED' : 'UNRECOGNIZED',
              grossCents: parsed?.grossCents ?? null,
              netCents: parsed?.netCents ?? null,
              fileKey,
              fileName: file.fileName,
              fileSha256,
              ...(parsed
                ? {
                    lines: {
                      create: parsed.lines.map((line, position) => ({ ...line, position })),
                    },
                  }
                : {}),
            },
          })
          return reply.status(201).send({ payslip: serializePayslip(payslip) })
        } catch (error) {
          // Sem linha no banco, o arquivo seria órfão no bucket.
          await deleteFile(fileKey, (key, err) =>
            request.log.error(
              { key, reason: err instanceof Error ? err.message : String(err) },
              'Falha ao apagar holerite órfão do bucket',
            ),
          )
          // Dois envios do mesmo PDF ao mesmo tempo: o segundo bate no índice único.
          if (isUniqueViolation(error)) {
            const existing = await findDuplicate()
            if (existing) throw new ConflictError(DUPLICATE, { payslipId: existing.id })
          }
          throw error
        }
      },
    )
}
