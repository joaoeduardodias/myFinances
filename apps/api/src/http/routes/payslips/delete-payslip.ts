import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { prisma } from '@/lib/prisma'
import { deleteFile } from '@/lib/storage'

import { NotFoundError } from '../_errors/not-found-error'

export async function deletePayslip(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .delete(
      '/payslips/:id',
      {
        schema: {
          tags: ['Payslips'],
          summary: 'Delete a payslip and its PDF.',
          operationId: 'deletePayslip',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params

        const payslip = await prisma.payslip.findFirst({
          select: { id: true, fileKey: true },
          where: { id, userId },
        })
        if (!payslip) throw new NotFoundError('Holerite não encontrado.')

        // Banco primeiro: se o bucket falhar, sobra um objeto órfão, nunca um
        // holerite apontando para um arquivo que não existe.
        await prisma.payslip.delete({ where: { id } })
        await deleteFile(payslip.fileKey, (key, err) =>
          request.log.error(
            { key, reason: err instanceof Error ? err.message : String(err) },
            'Falha ao apagar o PDF do holerite no bucket',
          ),
        )

        return reply.status(204).send(null)
      },
    )
}
