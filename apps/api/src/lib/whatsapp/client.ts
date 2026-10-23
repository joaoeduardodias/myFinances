import type { WhatsappSender } from '@/services/whatsapp/handle-message'

/** Versão da Graph API; subir só depois de conferir o changelog da Meta. */
export const GRAPH_VERSION = 'v23.0'
/** Sem isso uma Meta travada seguraria o webhook. */
const FETCH_TIMEOUT_MS = 15_000
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`

export function createWhatsappClient(cfg: {
  accessToken: string
  phoneNumberId: string
  fetch?: typeof fetch
}): WhatsappSender {
  const doFetch = cfg.fetch ?? fetch
  const auth = { Authorization: `Bearer ${cfg.accessToken}` }

  async function ok(response: Response, what: string) {
    if (!response.ok) throw new Error(`${what} falhou (HTTP ${response.status}).`)
    return response
  }

  return {
    async sendText(to, body) {
      await ok(
        await doFetch(`${GRAPH_URL}/${cfg.phoneNumberId}/messages`, {
          method: 'POST',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body },
          }),
        }),
        'Envio ao WhatsApp',
      )
    },

    async downloadMedia(id) {
      const meta = (await (
        await ok(await doFetch(`${GRAPH_URL}/${id}`, { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), 'Consulta da mídia')
      ).json()) as { url: string; mime_type: string }
      const file = await ok(await doFetch(meta.url, { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), 'Download da mídia')
      return { data: Buffer.from(await file.arrayBuffer()), mimeType: meta.mime_type }
    },
  }
}
