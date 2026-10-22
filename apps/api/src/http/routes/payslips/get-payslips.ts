import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'

import { payslipSchema, payslipSelect, serializePayslip } from './payslip-schema'

export async function getPayslips(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/payslips',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'List the user payslips, newest competence first.',
          operationId: 'getPayslips',
          security: [{ bearerAuth: [] }],
          response: { 200: z.object({ payslips: z.array(payslipSchema) }) },
        },
      },
      async (request) => {
        const userId = await request.getCurrentUserId()
        const payslips = await prisma.payslip.findMany({
          select: payslipSelect,
          where: { userId },
          orderBy: [{ competence: 'desc' }, { createdAt: 'desc' }],
        })
        return { payslips: payslips.map(serializePayslip) }
      },
    )
}
