import { api } from './api'

export type RecurrenceStatus = 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED'
export type RecurrenceDirection = 'IN' | 'OUT'
export type DayRule = 'DAY_OF_MONTH' | 'NTH_BUSINESS_DAY'
export type NonBusinessDayPolicy = 'ANTICIPATE' | 'POSTPONE' | 'KEEP'

export interface Recurrence {
  id: string
  accountId: string
  description: string
  descriptionKey: string
  direction: RecurrenceDirection
  expectedAmountCents: number
  dayRule: DayRule
  dayValue: number
  nonBusinessDayPolicy: NonBusinessDayPolicy
  status: RecurrenceStatus
  account: { name: string; type: string }
}

export interface RecurrenceInput {
  description: string
  expectedAmountCents: number
  dayRule: DayRule
  dayValue: number
  nonBusinessDayPolicy: NonBusinessDayPolicy
}

export interface CreateRecurrenceInput extends RecurrenceInput {
  accountId: string
  direction: RecurrenceDirection
}

/** O PATCH é estrito: aceita só estes campos (nada de accountId/direction). */
export interface UpdateRecurrenceInput extends Partial<RecurrenceInput> {
  status?: 'CONFIRMED'
}

export async function listRecurrences() {
  const { recurrences } = await api
    .get('recurrences')
    .json<{ recurrences: Recurrence[] }>()
  return recurrences
}

export async function createRecurrence(input: CreateRecurrenceInput) {
  await api.post('recurrences', { json: input })
}

export async function updateRecurrence(
  id: string,
  input: UpdateRecurrenceInput,
) {
  await api.patch(`recurrences/${id}`, { json: input })
}

export async function dismissRecurrence(id: string) {
  await api.post(`recurrences/${id}/dismiss`)
}
