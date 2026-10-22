import { z } from 'zod'

export const payslipType = z.enum(['MONTHLY', 'ADVANCE', 'THIRTEENTH', 'VACATION'])
export const payslipStatus = z.enum(['UNRECOGNIZED', 'RECOGNIZED', 'MANUAL'])
export const payslipLineKind = z.enum(['EARNING', 'DEDUCTION'])

export const competence = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência inválida (use AAAA-MM).')

export const payslipSelect = {
  id: true,
  competence: true,
  type: true,
  status: true,
  grossCents: true,
  netCents: true,
  fileName: true,
  createdAt: true,
} as const

export const payslipSchema = z.object({
  id: z.uuid(),
  competence: z.string(),
  type: payslipType,
  status: payslipStatus,
  grossCents: z.number().int().nullable(),
  netCents: z.number().int().nullable(),
  fileName: z.string(),
  createdAt: z.string(),
})

export const payslipLineSelect = {
  id: true,
  kind: true,
  description: true,
  reference: true,
  amountCents: true,
  position: true,
} as const

export const payslipLineSchema = z.object({
  id: z.uuid(),
  kind: payslipLineKind,
  description: z.string(),
  reference: z.string().nullable(),
  amountCents: z.number().int(),
  position: z.number().int(),
})

type PayslipRow = Omit<z.infer<typeof payslipSchema>, 'createdAt'> & { createdAt: Date }

export function serializePayslip(row: PayslipRow) {
  return { ...row, createdAt: row.createdAt.toISOString() }
}
