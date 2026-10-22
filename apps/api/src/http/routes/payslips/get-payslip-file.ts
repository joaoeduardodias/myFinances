import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { getSignedFileUrl } from '@/lib/storage'

import { NotFoundError } from '../_errors/not-found-error'

export async function getPayslipFile(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .get(
      '/payslips/:id/file',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Short-lived signed URL to download the payslip PDF.',
          operationId: 'getPayslipFile',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 200: z.object({ url: z.string() }) },
        },
      },
      async (request) => {
        const userId = await request.getCurrentUserId()
        const payslip = await prisma.payslip.findFirst({
          select: { fileKey: true, fileName: true },
          where: { id: request.params.id, userId },
        })
        if (!payslip) throw new NotFoundError('Holerite não encontrado.')

        return { url: await getSignedFileUrl(payslip.fileKey, payslip.fileName) }
      },
    )
}
