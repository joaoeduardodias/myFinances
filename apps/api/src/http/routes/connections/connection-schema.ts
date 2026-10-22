import { z } from 'zod'

export const connectionSelect = {
  id: true,
  connectorName: true,
  status: true,
  consentExpiresAt: true,
  lastSyncedAt: true,
  lastError: true,
} as const

export const connectionSchema = z.object({
  id: z.uuid(),
  connectorName: z.string(),
  status: z.string(),
  consentExpiresAt: z.date().nullable(),
  lastSyncedAt: z.date().nullable(),
  lastError: z.string().nullable(),
})
