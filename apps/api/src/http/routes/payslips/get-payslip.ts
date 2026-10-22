import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { fromDbDate, toDbDate } from '@/lib/db-date'
import {
  closestDeposit,
  RECONCILIATION_TOLERANCE_CENTS,
  reconciliationWindow,
} from '@/lib/payslip/reconciliation'
import { prisma } from '@/lib/prisma'

import { NotFoundError } from '../_errors/not-found-error'
import {
  payslipLineSchema,
  payslipLineSelect,
  payslipSchema,
  payslipSelect,
  serializePayslip,
} from './payslip-schema'

const depositSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  amountCents: z.number().int(),
  description: z.string(),
})

async function findDeposit(
  userId: string,
  payslip: { competence: string; type: Parameters<typeof reconciliationWindow>[1]; netCents: number | null },
) {
  if (payslip.netCents === null) return null
  const { from, to, target } = reconciliationWindow(payslip.competence, payslip.type)

  const candidates = await prisma.transaction.findMany({
    select: { id: true, date: true, amountCents: true, description: true },
    where: {
      userId,
      isTransfer: false,
      // Só entrada: um líquido perto de zero não pode casar com uma saída.
      amountCents: {
        gte: Math.max(1, payslip.netCents - RECONCILIATION_TOLERANCE_CENTS),
        lte: payslip.netCents + RECONCILIATION_TOLERANCE_CENTS,
      },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
    },
  })

  return closestDeposit(
    candidates.map((tx) => ({ ...tx, date: fromDbDate(tx.date) })),
    target,
  )
}

export async function getPayslip(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/payslips/:id',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Payslip details, lines and whether the net amount was deposited.',
          operationId: 'getPayslip',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: {
            200: z.object({
              payslip: payslipSchema,
              lines: z.array(payslipLineSchema),
              reconciliation: z.object({
                matched: z.boolean(),
                transaction: depositSchema.nullable(),
              }),
            }),
          },
        },
      },
      async (request) => {
        const userId = await request.getCurrentUserId()
        const row = await prisma.payslip.findFirst({
          select: {
            ...payslipSelect,
            lines: { select: payslipLineSelect, orderBy: { position: 'asc' } },
          },
          where: { id: request.params.id, userId },
        })
        if (!row) throw new NotFoundError('Holerite não encontrado.')

        const { lines, ...payslip } = row
        const deposit = await findDeposit(userId, payslip)

        return {
          payslip: serializePayslip(payslip),
          lines,
          reconciliation: { matched: deposit !== null, transaction: deposit },
        }
      },
    )
}
