import { createHmac, timingSafeEqual } from 'node:crypto'

import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

import { createWhatsappClient } from '@/lib/whatsapp/client'
import {
  handleWhatsappMessage,
  type IncomingMessage,
} from '@/services/whatsapp/handle-message'

import { UnauthorizedError } from '../_errors/unauthorized-error'

export type WhatsappConfig = {
  accessToken: string
  appSecret: string
  verifyToken: string
  phoneNumberId: string
}

function safeEqual(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  // `timingSafeEqual` lança com tamanhos diferentes.
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Header `X-Hub-Signature-256: sha256=<hex>`: HMAC-SHA256 do corpo cru com o segredo do app. */
export function verifyMetaSignature(rawBody: Buffer, header: unknown, appSecret: string): boolean {
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  return safeEqual(header, expected)
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function extractMessages(payload: unknown, phoneNumberId: string): IncomingMessage[] {
  const out: IncomingMessage[] = []
  if (!isObj(payload)) return out
  for (const entry of asArray(payload.entry)) {
    if (!isObj(entry)) continue
    for (const change of asArray(entry.changes)) {
      const value = isObj(change) ? change.value : undefined
      if (!isObj(value)) continue
      const meta = value.metadata
      if (!isObj(meta) || meta.phone_number_id !== phoneNumberId) continue
      for (const m of asArray(value.messages)) {
        if (!isObj(m) || typeof m.id !== 'string' || typeof m.from !== 'string') continue
        const base = { id: m.id, from: m.from }
        if (m.type === 'text' && isObj(m.text) && typeof m.text.body === 'string') {
          out.push({ ...base, text: m.text.body })
        } else if (m.type === 'image' && isObj(m.image) && typeof m.image.id === 'string') {
          const caption = typeof m.image.caption === 'string' ? m.image.caption : undefined
          out.push({ ...base, imageId: m.image.id, ...(caption ? { text: caption } : {}) })
        } else {
          out.push({ ...base, unsupported: true })
        }
      }
    }
  }
  return out
}

async function processMessages(
  messages: IncomingMessage[],
  client: ReturnType<typeof createWhatsappClient>,
  log: Pick<FastifyBaseLogger, 'error'>,
) {
  for (const msg of messages) {
    try {
      await handleWhatsappMessage(msg, { client })
    } catch (error) {
      log.error({ err: error, messageId: msg.id }, 'Falha ao processar mensagem do WhatsApp')
    }
  }
}

function whatsappWebhook(cfg: WhatsappConfig) {
  return async function whatsappWebhookRoute(app: FastifyInstance) {
    const client = createWhatsappClient({
      accessToken: cfg.accessToken,
      phoneNumberId: cfg.phoneNumberId,
    })

    // Só neste plugin: a assinatura é sobre os bytes exatos do corpo.
    app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    )

    app.get('/webhooks/whatsapp', async (request, reply) => {
      const q = request.query as Record<string, unknown>
      if (q['hub.mode'] === 'subscribe' && safeEqual(q['hub.verify_token'], cfg.verifyToken)) {
        return reply.type('text/plain').send(String(q['hub.challenge'] ?? ''))
      }
      return reply.status(403).send()
    })

    app.post('/webhooks/whatsapp', async (request, reply) => {
      const raw = request.body
      if (
        !Buffer.isBuffer(raw) ||
        !verifyMetaSignature(raw, request.headers['x-hub-signature-256'], cfg.appSecret)
      ) {
        throw new UnauthorizedError('Webhook não autorizado.')
      }
      let payload: unknown
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        return reply.status(400).send()
      }
      const messages = extractMessages(payload, cfg.phoneNumberId)
      const log = request.log
      // A Meta reenvia se a resposta demorar: responde já e processa depois.
      setImmediate(() => {
        processMessages(messages, client, log).catch(() => undefined)
      })
      return reply.status(200).send()
    })
  }
}

/** Sem configuração completa a rota nem existe (404). */
export function registerWhatsappWebhook(app: FastifyInstance, cfg: WhatsappConfig | undefined) {
  if (cfg) app.register(whatsappWebhook(cfg))
}
