import { env } from '@myfinances/env'
import webpush from 'web-push'

import { prisma } from '@/lib/prisma'

const vapid =
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null

/** Nulo = push desligado: o web não oferece ativar. */
export const pushPublicKey = vapid?.publicKey ?? null

// Um dia: o aviso continua no sininho, então não vale entregar muito depois.
const TTL_SECONDS = 24 * 60 * 60

/**
 * Replica no navegador os avisos que acabaram de ser gravados. Nunca lança:
 * o aviso já está guardado e o push é só uma cópia.
 */
export async function sendPush(
  userId: string,
  notifications: { id: string; title: string; body: string }[],
): Promise<void> {
  if (!vapid || notifications.length === 0) return
  try {
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } })
    const expired = new Set<string>()
    await Promise.all(
      subscriptions.flatMap((s) =>
        notifications.map(async (n) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ id: n.id, title: n.title, body: n.body }),
              { TTL: TTL_SECONDS, vapidDetails: vapid },
            )
          } catch (error) {
            const status = (error as { statusCode?: number }).statusCode
            // 404/410: o navegador cancelou a inscrição.
            if (status === 404 || status === 410) expired.add(s.id)
            else console.error('Falha ao enviar push', error)
          }
        }),
      ),
    )
    if (expired.size > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: [...expired] } } })
    }
  } catch (error) {
    console.error('Falha ao enviar push', error)
  }
}
