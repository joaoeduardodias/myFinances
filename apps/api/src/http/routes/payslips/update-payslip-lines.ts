import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import {
  payslipLineKind,
  payslipLineSchema,
  payslipLineSelect,
  payslipSchema,
  payslipSelect,
  serializePayslip,
} from './payslip-schema'

export async function updatePayslipLines(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .put(
      '/payslips/:id/lines',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Replace all payslip lines with a manual entry.',
          operationId: 'updatePayslipLines',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          body: z.object({
            grossCents: z.number().int().nonnegative().optional(),
            netCents: z.number().int().nonnegative(),
            lines: z
              .array(
                z.object({
                  kind: payslipLineKind,
                  description: z.string().trim().min(1).max(200),
                  reference: z.string().trim().max(50).nullable(),
                  amountCents: z.number().int().positive(),
                }),
              )
              .max(200),
          }),
          response: {
            200: z.object({ payslip: payslipSchema, lines: z.array(payslipLineSchema) }),
          },
        },
      },
      async (request) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const { grossCents, netCents, lines } = request.body

        const owned = await prisma.payslip.findFirst({ select: { id: true }, where: { id, userId } })
        if (!owned) throw new NotFoundError('Holerite não encontrado.')

        const [payslip, savedLines] = await prisma.$transaction(async (tx) => {
          await tx.payslipLine.deleteMany({ where: { payslipId: id } })
          await tx.payslipLine.createMany({
            data: lines.map((line, position) => ({ payslipId: id, ...line, position })),
          })
          const updated = await tx.payslip.update({
            select: payslipSelect,
            where: { id },
            // `grossCents` omitido mantém o bruto que já estava gravado.
            data: { status: 'MANUAL', grossCents, netCents },
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
