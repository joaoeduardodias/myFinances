import { api } from './api'

/**
 * Adicionar e sincronizar esperam a API ler até um ano da Pluggy; os 10 s
 * padrão do ky cortariam no meio uma sincronização que está dando certo.
 */
export const PLUGGY_SYNC_TIMEOUT_MS = 120_000

export interface Connection {
  id: string
  connectorName: string
  status: string
  consentExpiresAt: string | null
  lastSyncedAt: string | null
  lastError: string | null
}

export async function listConnections() {
  const { connections } = await api
    .get('connections')
    .json<{ connections: Connection[] }>()
  return connections
}

export async function createConnection(itemId: string) {
  await api.post('connections', {
    json: { itemId },
    timeout: PLUGGY_SYNC_TIMEOUT_MS,
  })
}

export async function syncConnection(id: string) {
  await api.post(`connections/${id}/sync`, { timeout: PLUGGY_SYNC_TIMEOUT_MS })
}

export async function deleteConnection(id: string) {
  await api.delete(`connections/${id}`)
}
