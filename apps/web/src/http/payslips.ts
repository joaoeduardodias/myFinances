import { HTTPError } from 'ky'

import { api } from './api'

export type PayslipType = 'MONTHLY' | 'ADVANCE' | 'THIRTEENTH' | 'VACATION'
export type PayslipStatus = 'UNRECOGNIZED' | 'RECOGNIZED' | 'MANUAL'
export type PayslipLineKind = 'EARNING' | 'DEDUCTION'

export const PAYSLIP_TYPE_LABELS: Record<PayslipType, string> = {
  MONTHLY: 'Mensal',
  ADVANCE: 'Adiantamento',
  THIRTEENTH: '13º salário',
  VACATION: 'Férias',
}

export interface Payslip {
  id: string
  /** 'YYYY-MM' */
  competence: string
  type: PayslipType
  status: PayslipStatus
  grossCents: number | null
  netCents: number | null
  fileName: string
  createdAt: string
}

export interface PayslipLine {
  id: string
  kind: PayslipLineKind
  description: string
  reference: string | null
  amountCents: number
  position: number
}

export interface PayslipDetailData {
  payslip: Payslip
  lines: PayslipLine[]
  reconciliation: {
    matched: boolean
    transaction: {
      id: string
      date: string
      amountCents: number
      description: string
    } | null
  }
}

export interface PayslipLinesInput {
  grossCents?: number
  netCents: number
  lines: {
    kind: PayslipLineKind
    description: string
    reference: string | null
    amountCents: number
  }[]
}

export interface UploadPayslipInput {
  competence: string
  type: PayslipType
  file: File
}

/** O arquivo já foi enviado antes: `payslipId` é o holerite existente. */
export class DuplicatePayslipError extends Error {
  constructor(public readonly payslipId: string) {
    super('Este arquivo já foi enviado')
    this.name = 'DuplicatePayslipError'
  }
}

export async function listPayslips() {
  const { payslips } = await api.get('payslips').json<{ payslips: Payslip[] }>()
  return payslips
}

export async function uploadPayslip(input: UploadPayslipInput) {
  // FormData: o ky/fetch define o Content-Type com o boundary sozinho.
  const body = new FormData()
  body.append('competence', input.competence)
  body.append('type', input.type)
  body.append('file', input.file)
  try {
    const { payslip } = await api
      .post('payslips', { body })
      .json<{ payslip: Payslip }>()
    return payslip
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 409) {
      const data = await error.response
        .json<{ payslipId?: string }>()
        .catch(() => ({}) as { payslipId?: string })
      if (data.payslipId) throw new DuplicatePayslipError(data.payslipId)
    }
    throw error
  }
}

export function getPayslip(id: string) {
  return api.get(`payslips/${id}`).json<PayslipDetailData>()
}

export function savePayslipLines(id: string, input: PayslipLinesInput) {
  return api
    .put(`payslips/${id}/lines`, { json: input })
    .json<{ payslip: Payslip; lines: PayslipLine[] }>()
}

export async function getPayslipFileUrl(id: string) {
  const { url } = await api.get(`payslips/${id}/file`).json<{ url: string }>()
  return url
}

export async function deletePayslip(id: string) {
  await api.delete(`payslips/${id}`)
}
