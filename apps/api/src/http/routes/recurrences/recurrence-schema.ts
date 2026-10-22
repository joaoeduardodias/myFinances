import { z } from 'zod'

import { BadRequestError } from '../_errors/bad-request-error'

export const recurrenceDirection = z.enum(['IN', 'OUT'])
export const dayRule = z.enum(['DAY_OF_MONTH', 'NTH_BUSINESS_DAY'])
export const nonBusinessDayPolicy = z.enum(['ANTICIPATE', 'POSTPONE', 'KEEP'])
export const recurrenceStatus = z.enum(['SUGGESTED', 'CONFIRMED', 'DISMISSED'])

export const recurrenceFields = {
  accountId: z.uuid(),
  description: z.string().trim().min(1).max(200),
  direction: recurrenceDirection,
  expectedAmountCents: z.number().int().positive(),
  dayRule,
  dayValue: z.number().int().min(1).max(31),
  nonBusinessDayPolicy,
}

export const recurrenceSelect = {
  id: true,
  accountId: true,
  description: true,
  direction: true,
  expectedAmountCents: true,
  dayRule: true,
  dayValue: true,
  nonBusinessDayPolicy: true,
  status: true,
  account: { select: { name: true, type: true } },
} as const

export const recurrenceSchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  description: z.string(),
  direction: recurrenceDirection,
  expectedAmountCents: z.number().int(),
  dayRule,
  dayValue: z.number().int(),
  nonBusinessDayPolicy,
  status: recurrenceStatus,
  account: z.object({ name: z.string(), type: z.string() }),
})

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
