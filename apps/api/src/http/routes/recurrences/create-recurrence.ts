import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { toDbDate } from '@/lib/db-date'
import { descriptionKey } from '@/lib/finance/description-key'
import { prisma } from '@/lib/prisma'
import { todayIso } from '@/lib/today'
import {
  loadMonthTxs,
  loadPayrollIncomes,
  recurrenceViewSelect,
  toRecurrenceView,
} from '@/services/recurrence-view'
import { syncPayrollLinks } from '@/services/sync-payroll-links'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'
import {
  assertDayValue,
  assertDescriptionKey,
  assertLoanFields,
  assertPayrollSource,
  recurrenceFields,
  recurrenceSchema,
} from './recurrence-schema'

export async function createRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .post(
      '/recurrences',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Create a confirmed recurrence manually; the account is optional.',
          operationId: 'createRecurrence',
          security: [{ bearerAuth: [] }],
          body: z.object({
            ...recurrenceFields,
            accountId: recurrenceFields.accountId.optional(),
            kind: recurrenceFields.kind.default('MONTHLY'),
            nonBusinessDayPolicy: recurrenceFields.nonBusinessDayPolicy.default('ANTICIPATE'),
            remainingInstallments: recurrenceFields.remainingInstallments.optional(),
            payrollDeduction: recurrenceFields.payrollDeduction.optional(),
            payrollSourceId: recurrenceFields.payrollSourceId.optional(),
          }),
          response: { 201: z.object({ recurrence: recurrenceSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { remainingInstallments, ...body } = request.body
        const today = todayIso()
        assertDayValue(body.dayRule, body.dayValue)
        assertLoanFields(body.kind, remainingInstallments, {
          payrollDeduction: body.payrollDeduction ?? false,
          direction: body.direction,
        })
        const key = descriptionKey(body.description)
        assertDescriptionKey(key)

        if (body.payrollSourceId) {
          if (!body.payrollDeduction) throw new BadRequestError('Recebimento só vale para desconto em folha.')
          await assertPayrollSource(userId, body.payrollSourceId)
        }

        if (body.accountId) {
          const account = await prisma.account.findFirst({
            select: { id: true },
            where: { id: body.accountId, userId },
          })
          if (!account) throw new NotFoundError('Conta não encontrada.')
        }

        const created = await prisma.recurrence.create({
          select: recurrenceViewSelect,
          data: {
            ...body,
            userId,
            descriptionKey: key,
            status: 'CONFIRMED',
            ...(remainingInstallments ? { remainingInstallments, remainingAsOf: toDbDate(today) } : {}),
          },
        })
        // Em folha, o salário que já caiu entra na hora, sem esperar a próxima sincronização.
        let row = created
        if (created.payrollDeduction) {
          await syncPayrollLinks(userId, today)
          row = (await prisma.recurrence.findFirst({ select: recurrenceViewSelect, where: { id: created.id, userId } })) ?? created
        }
        const [monthTxs, incomes] = await Promise.all([loadMonthTxs(userId, today), loadPayrollIncomes(userId, row)])
        return reply.status(201).send({ recurrence: toRecurrenceView(row, today, monthTxs, incomes) })
      },
    )
}
