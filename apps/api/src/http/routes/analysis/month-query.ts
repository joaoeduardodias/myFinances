import { z } from 'zod'

import { analysisMonths } from '@/services/load-analysis'

import { BadRequestError } from '../_errors/bad-request-error'

export const monthQuerySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

/** `month` tem de ser um dos 12 meses da janela da análise. */
export function assertMonthInWindow(month: string | undefined, today: string): void {
  if (month !== undefined && !analysisMonths(today).includes(month)) {
    throw new BadRequestError('Mês fora dos últimos 12 meses.')
  }
}
