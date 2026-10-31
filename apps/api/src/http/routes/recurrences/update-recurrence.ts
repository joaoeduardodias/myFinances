import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { auth } from '@/http/middlewares/auth'
import { toDbDate } from '@/lib/db-date'
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
  assertLoanFields,
  assertPayrollSource,
  recurrenceFields,
  recurrenceSchema,
} from './recurrence-schema'

export async function updateRecurrence(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .register(auth)
    .patch(
      '/recurrences/:id',
      {
        schema: {
          tags: ['Recurrences'],
          summary: 'Edit a recurrence; status CONFIRMED confirms or reopens, PAID_OFF pays off a loan.',
          operationId: 'updateRecurrence',
          security: [{ bearerAuth: [] }],
          params: z.object({ id: z.uuid() }),
          // Sem `direction`, e `description` é só rótulo: `descriptionKey` e sentido
          // são a identidade que impede a detecção de ressuscitar o que foi descartado.
          // A conta pode mudar: o recorrente vale para qualquer uma.
          body: z
            .strictObject({
              accountId: recurrenceFields.accountId.nullable(),
              kind: recurrenceFields.kind,
              description: recurrenceFields.description,
              expectedAmountCents: recurrenceFields.expectedAmountCents,
              dayRule: recurrenceFields.dayRule,
              dayValue: recurrenceFields.dayValue,
              nonBusinessDayPolicy: recurrenceFields.nonBusinessDayPolicy,
              remainingInstallments: recurrenceFields.remainingInstallments.nullable(),
              payrollDeduction: recurrenceFields.payrollDeduction,
              payrollSourceId: recurrenceFields.payrollSourceId.nullable(),
              status: z.enum(['CONFIRMED', 'PAID_OFF']),
            })
            .partial(),
          response: { 200: z.object({ recurrence: recurrenceSchema }) },
        },
      },
      async (request, reply) => {
        const userId = await request.getCurrentUserId()
        const { id } = request.params
        const body = request.body
        const today = todayIso()

        const current = await prisma.recurrence.findFirst({
          select: { dayRule: true, dayValue: true, kind: true, status: true, direction: true, payrollDeduction: true },
          where: { id, userId },
        })
        if (!current) throw new NotFoundError('Recorrência não encontrada.')

        // A regra e o dia podem chegar separados; valida o par que vai ficar gravado.
        assertDayValue(body.dayRule ?? current.dayRule, body.dayValue ?? current.dayValue)
        const kind = body.kind ?? current.kind
        // Virar fora da Pluggy desliga o desconto em folha (abaixo); ligar exige saída mensal ou empréstimo.
        assertLoanFields(kind, body.remainingInstallments, {
          payrollDeduction: body.payrollDeduction ?? (kind !== 'EXTERNAL' && current.payrollDeduction),
          direction: current.direction,
        })
        if (body.status === 'PAID_OFF' && kind !== 'LOAN') {
          throw new BadRequestError('Só empréstimo pode ser quitado.')
        }

        if (body.payrollSourceId) await assertPayrollSource(userId, body.payrollSourceId)

        if (body.accountId) {
          const account = await prisma.account.findFirst({ select: { id: true }, where: { id: body.accountId, userId } })
          if (!account) throw new NotFoundError('Conta não encontrada.')
        }

        const { remainingInstallments, ...fields } = body
        const data = {
          ...fields,
          ...(remainingInstallments !== undefined && {
            remainingInstallments,
            remainingAsOf: remainingInstallments === null ? null : toDbDate(today),
          }),
          // Deixar de ser empréstimo apaga as parcelas e desfaz a quitação.
          ...(kind !== 'LOAN' &&
            current.kind === 'LOAN' && {
              remainingInstallments: null,
              remainingAsOf: null,
              ...(current.status === 'PAID_OFF' && !body.status && { status: 'CONFIRMED' as const }),
            }),
          // Fora da Pluggy não sai do salário.
          ...(kind === 'EXTERNAL' &&
            current.payrollDeduction && { payrollDeduction: false, payrollSourceId: null }),
        }

        let row = await prisma.recurrence.update({ select: recurrenceViewSelect, where: { id }, data })
        // Ligar o desconto em folha ou trocar o salário vincula o que já caiu, sem esperar a sincronização.
        if (row.payrollDeduction && row.status === 'CONFIRMED') {
          await syncPayrollLinks(userId, today)
          row = (await prisma.recurrence.findFirst({ select: recurrenceViewSelect, where: { id, userId } })) ?? row
        }
        const [monthTxs, incomes] = await Promise.all([loadMonthTxs(userId, today), loadPayrollIncomes(userId, row)])
        return reply.send({ recurrence: toRecurrenceView(row, today, monthTxs, incomes) })
      },
    )
}
