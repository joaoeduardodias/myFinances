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

/** Os `value` do payload que são do nosso número. */
function valuesFor(payload: unknown, phoneNumberId: string): Raw[] {
  const out: Raw[] = []
  if (!isObj(payload)) return out
  for (const entry of asArray(payload.entry)) {
    if (!isObj(entry)) continue
    for (const change of asArray(entry.changes)) {
      const value = isObj(change) ? change.value : undefined
      if (!isObj(value)) continue
      const meta = value.metadata
      if (isObj(meta) && meta.phone_number_id === phoneNumberId) out.push(value)
    }
  }
  return out
}

export function extractMessages(payload: unknown, phoneNumberId: string): IncomingMessage[] {
  const out: IncomingMessage[] = []
  for (const value of valuesFor(payload, phoneNumberId)) {
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
  return out
}

/**
 * A Meta aceita o envio (200) e só avisa depois, num status `failed`, que não
 * entregou. Sem isso a resposta do bot some sem rastro. Fica sem o
 * `recipient_id` para não gravar o telefone no log.
 */
export function extractDeliveryFailures(
  payload: unknown,
  phoneNumberId: string,
): { id: unknown; errors: unknown }[] {
  return valuesFor(payload, phoneNumberId).flatMap((value) =>
    asArray(value.statuses)
      .filter((st): st is Raw => isObj(st) && st.status === 'failed')
      .map((st) => ({ id: st.id, errors: st.errors })),
  )
}

/**
 * Resumo de um webhook que não trouxe mensagem para o nosso número: campo,
 * número e chaves do `value`, sem telefone nem texto. Sem isso o evento some
 * sem rastro (ex.: mensagem mandada a outro número da conta).
 */
export function describeEvents(payload: unknown) {
  if (!isObj(payload)) return []
  return asArray(payload.entry).flatMap((entry) =>
    asArray(isObj(entry) ? entry.changes : undefined).map((change) => {
      const c = isObj(change) ? change : {}
      const value = isObj(c.value) ? c.value : {}
      const meta = isObj(value.metadata) ? value.metadata : {}
      return { field: c.field, phoneNumberId: meta.phone_number_id, keys: Object.keys(value) }
    }),
  )
}

async function processMessages(
  messages: IncomingMessage[],
  client: ReturnType<typeof createWhatsappClient>,
  log: Pick<FastifyBaseLogger, 'error' | 'info'>,
) {
  for (const msg of messages) {
    try {
      await handleWhatsappMessage(msg, { client, log })
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
      const failures = extractDeliveryFailures(payload, cfg.phoneNumberId)
      for (const failure of failures) {
        log.warn(failure, 'Meta não entregou a mensagem do WhatsApp')
      }
      if (messages.length === 0 && failures.length === 0) {
        log.info({ events: describeEvents(payload) }, 'Webhook do WhatsApp sem mensagem para o número')
      }
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
