import { api } from './api'

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
  await api.post('connections', { json: { itemId } })
}

export async function syncConnection(id: string) {
  await api.post(`connections/${id}/sync`)
}

export async function deleteConnection(id: string) {
  await api.delete(`connections/${id}`)
}
