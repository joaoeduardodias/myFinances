import { z } from 'zod'

import { prisma } from '@/lib/prisma'

import { BadRequestError } from '../_errors/bad-request-error'
import { NotFoundError } from '../_errors/not-found-error'

export const recurrenceDirection = z.enum(['IN', 'OUT'])
export const dayRule = z.enum(['DAY_OF_MONTH', 'NTH_BUSINESS_DAY'])
export const nonBusinessDayPolicy = z.enum(['ANTICIPATE', 'POSTPONE', 'KEEP'])
export const recurrenceStatus = z.enum(['SUGGESTED', 'CONFIRMED', 'DISMISSED', 'PAID_OFF'])
export const recurrenceKind = z.enum(['MONTHLY', 'LOAN', 'EXTERNAL'])

/** Mais que 50 anos de parcelas é erro de digitação. */
const MAX_INSTALLMENTS = 600

export const recurrenceFields = {
  accountId: z.uuid(),
  kind: recurrenceKind,
  description: z.string().trim().min(1).max(200),
  direction: recurrenceDirection,
  expectedAmountCents: z.number().int().positive(),
  dayRule,
  dayValue: z.number().int().min(1).max(31),
  nonBusinessDayPolicy,
  remainingInstallments: z.number().int().min(1).max(MAX_INSTALLMENTS),
  payrollDeduction: z.boolean(),
  payrollSourceId: z.uuid(),
}

const monthStatusSchema = z.object({
  state: z.enum(['PAID', 'DUE', 'LATE']),
  date: z.string(),
  days: z.number().int(),
})

export const recurrenceSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid().nullable(),
  kind: recurrenceKind,
  description: z.string(),
  direction: recurrenceDirection,
  expectedAmountCents: z.number().int(),
  dayRule,
  dayValue: z.number().int(),
  nonBusinessDayPolicy,
  status: recurrenceStatus,
  remainingInstallments: z.number().int().nullable(),
  payrollDeduction: z.boolean(),
  payrollSourceId: z.uuid().nullable(),
  payrollSource: z.object({ id: z.uuid(), description: z.string() }).nullable(),
  account: z.object({ name: z.string(), type: z.string() }).nullable(),
  paidOff: z.boolean(),
  monthStatus: monthStatusSchema.nullable(),
  linkedCount: z.number().int(),
  lastLinkedDate: z.string().nullable(),
  loan: z
    .object({
      remaining: z.number().int().nullable(),
      remainingCents: z.number().int().nullable(),
      endMonth: z.string().nullable(),
    })
    .nullable(),
})

/** Transação como aparece no recorrente (vinculadas, parecidas e a janela de escolha). */
export const recurrenceTxSchema = z.object({
  id: z.uuid(),
  date: z.string(),
  description: z.string(),
  amountCents: z.number().int(),
  account: z.object({ name: z.string() }),
})

export const recurrenceTxSelect = {
  id: true,
  date: true,
  description: true,
  amountCents: true,
  account: { select: { name: true } },
} as const

export function assertLoanFields(
  kind: z.infer<typeof recurrenceKind>,
  remaining: number | null | undefined,
  payroll?: { payrollDeduction: boolean; direction: z.infer<typeof recurrenceDirection> },
) {
  if (kind !== 'LOAN' && remaining != null) {
    throw new BadRequestError('Parcelas que faltam só valem para empréstimo.')
  }
  // Empréstimo ou saída mensal (plano de saúde, sindicato): o que sai do salário.
  if (payroll?.payrollDeduction && (kind === 'EXTERNAL' || payroll.direction !== 'OUT')) {
    throw new BadRequestError('Desconto em folha só vale para saída mensal ou empréstimo.')
  }
}

// Nenhum mês tem mais que 23 dias úteis; acima disso `nthBusinessDay` recusa.
const MAX_BUSINESS_DAY = 23

export function assertDayValue(rule: z.infer<typeof dayRule>, value: number) {
  if (rule === 'NTH_BUSINESS_DAY' && value > MAX_BUSINESS_DAY) {
    throw new BadRequestError(`O dia útil deve ser de 1 a ${MAX_BUSINESS_DAY}.`)
  }
}

export function assertDescriptionKey(key: string) {
  if (!key) {
    throw new BadRequestError('A descrição precisa ter ao menos uma letra.')
  }
}

/** O recebimento de que o empréstimo em folha é descontado: do usuário e mensal de entrada. */
export async function assertPayrollSource(userId: string, id: string) {
  const source = await prisma.recurrence.findFirst({
    select: { id: true, kind: true, direction: true, status: true },
    where: { id, userId },
  })
  if (!source) throw new NotFoundError('Recebimento não encontrado.')
  if (source.kind !== 'MONTHLY' || source.direction !== 'IN' || source.status !== 'CONFIRMED') {
    throw new BadRequestError('O desconto em folha precisa sair de um recebimento mensal confirmado.')
  }
}
