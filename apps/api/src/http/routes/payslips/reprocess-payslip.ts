import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { parsePayslip } from '@/lib/payslip/parse'
import { prisma } from '@/lib/prisma'
import { getFile } from '@/lib/storage'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'
import {
  payslipLineSchema,
  payslipLineSelect,
  payslipSchema,
  payslipSelect,
  serializePayslip,
} from './payslip-schema'

const UNREADABLE = 'Não foi possível ler este holerite. Lance os valores à mão.'

export async function reprocessPayslip(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/payslips/:id/reprocess',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Read the stored PDF again and replace the lines with what was recognized.',
          operationId: 'reprocessPayslip',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: {
            200: z.object({ payslip: payslipSchema, lines: z.array(payslipLineSchema) }),
          },
        },
      },
      async (request) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const owned = await prisma.payslip.findFirst({ select: { id: true, fileKey: true }, where: { id, userId } })
        if (!owned) throw new NotFoundError('Holerite não encontrado.')

        const parsed = await parsePayslip(await getFile(owned.fileKey), (error) =>
          request.log.warn(
            { payslipId: id, reason: error instanceof Error ? error.message : String(error) },
            'Holerite não abriu',
          ),
        )
        // Sem leitura, as linhas que já estavam (lançadas à mão ou não) ficam como estão.
        if (!parsed) throw new BadRequestError(UNREADABLE)

        const [payslip, savedLines] = await prisma.$transaction(async (tx) => {
          await tx.payslipLine.deleteMany({ where: { payslipId: id } })
          await tx.payslipLine.createMany({
            data: parsed.lines.map((line, position) => ({ payslipId: id, ...line, position })),
          })
          const updated = await tx.payslip.update({
            select: payslipSelect,
            where: { id },
            data: { status: 'RECOGNIZED', grossCents: parsed.grossCents, netCents: parsed.netCents },
          })
          const saved = await tx.payslipLine.findMany({
            select: payslipLineSelect,
            where: { payslipId: id },
            orderBy: { position: 'asc' },
          })
          return [updated, saved] as const
        })

        return { payslip: serializePayslip(payslip), lines: savedLines }
      },
    )
}
