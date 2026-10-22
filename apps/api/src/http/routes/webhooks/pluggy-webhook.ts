import { timingSafeEqual } from 'node:crypto'

import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { pluggy } from '@/lib/pluggy/client'
import { itemErrorText } from '@/lib/pluggy/connection-error'
import { prisma } from '@/lib/prisma'
import { removeTransactions } from '@/services/remove-transactions'
import { syncConnection } from '@/services/sync-connection'

import { UnauthorizedError } from '../_errors/unauthorized-error'
import { WEBHOOK_SECRET_HEADER } from './webhook-secret-header'

const bodySchema = z.object({
  event: z.string(),
  itemId: z.string().optional(),
  transactionIds: z.array(z.string()).optional(),
})

export type PluggyWebhookEvent = z.infer<typeof bodySchema>

function secretMatches(received: unknown, expected: string): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  // `timingSafeEqual` lança com tamanhos diferentes.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Processa um evento já aceito. Nunca rejeita: roda fora do ciclo da resposta,
 * então um erro aqui seria uma rejeição não tratada.
 */
export async function processPluggyEvent(
  payload: PluggyWebhookEvent,
  log: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  try {
    const { event, itemId, transactionIds } = payload

    switch (event) {
      case 'item/created':
      case 'item/updated':
      case 'transactions/created':
      case 'transactions/updated': {
        if (!itemId) return
        const connection = await prisma.connection.findUnique({
          select: { id: true },
          where: { pluggyItemId: itemId },
        })
        if (connection) await syncConnection(connection.id)
        return
      }
      case 'item/error': {
        if (!itemId) return
        const item = await pluggy.getItem(itemId)
        await prisma.connection.updateMany({
          where: { pluggyItemId: itemId },
          data: { status: item.status, lastError: itemErrorText(item.error) },
        })
        return
      }
      case 'transactions/deleted': {
        if (!transactionIds?.length) return
        // Mesma limpeza da sincronização: par desfeito e crédito do saque na Carteira.
        await removeTransactions({
          source: 'PLUGGY',
          pluggyTransactionId: { in: transactionIds },
        })
        break
      }
    }
  } catch (error) {
    log.error({ err: error, event: payload.event, itemId: payload.itemId }, 'Falha ao processar webhook da Pluggy')
  }
}

export function pluggyWebhook(secret: string) {
  return async function pluggyWebhookRoute(app: FastifyInstance) {
    app.withTypeProvider<ZodTypeProvider>().post(
      '/webhooks/pluggy',
      {
        // `onRequest` roda antes da validação do corpo: sem segredo válido
        // nem chegamos a olhar o que foi enviado.
        onRequest: async (request) => {
          if (!secretMatches(request.headers[WEBHOOK_SECRET_HEADER], secret)) {
            throw new UnauthorizedError('Webhook não autorizado.')
          }
        },
        schema: {
          tags: ['Webhooks'],
          summary: 'Receive Pluggy webhook events.',
          operationId: 'pluggyWebhook',
          body: bodySchema,
        },
      },
      async (request, reply) => {
        const payload = request.body
        const log = request.log
        // A Pluggy exige 2XX em até 10 s e reenvia em qualquer outra resposta.
        setImmediate(() => {
          processPluggyEvent(payload, log).catch(() => undefined)
        })
        return reply.status(202).send()
      },
    )
  }
}

/** Só registra a rota quando há segredo; sem ele a rota não existe (404). */
export function registerPluggyWebhook(
  app: FastifyInstance,
  secret: string | undefined,
) {
  if (secret) app.register(pluggyWebhook(secret))
}
