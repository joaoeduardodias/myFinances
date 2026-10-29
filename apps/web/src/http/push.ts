import { api } from './api'

export function getPushPublicKey() {
  return api.get('push/public-key').json<{ publicKey: string | null }>()
}

export async function savePushSubscription(subscription: PushSubscriptionJSON) {
  await api.post('push/subscriptions', { json: subscription })
}

export async function removePushSubscription(endpoint: string) {
  await api.delete('push/subscriptions', { json: { endpoint } })
}
