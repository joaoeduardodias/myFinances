import { z } from 'zod'


export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
