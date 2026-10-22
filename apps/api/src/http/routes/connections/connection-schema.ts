import { z } from 'zod'

import { friendlyConnectionError } from '@/lib/pluggy/connection-error'

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

/** O `lastError` do banco é o texto cru da Pluggy; quem lê a API vê a frase em português. */
export function serializeConnection<T extends { lastError: string | null }>(row: T): T {
  return { ...row, lastError: friendlyConnectionError(row.lastError) }
}
