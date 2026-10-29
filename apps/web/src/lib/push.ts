import {
  getPushPublicKey,
  removePushSubscription,
  savePushSubscription,
} from '@/http/push'

export function isPushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration()
  return (await registration?.pushManager.getSubscription()) ?? null
}

// A chave VAPID vem em base64url; o PushManager quer os bytes.
function keyBytes(base64url: string) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export type EnablePushResult = 'enabled' | 'denied' | 'unavailable'

/** Pede permissão, inscreve o navegador e guarda a inscrição na API. */
export async function enablePush(): Promise<EnablePushResult> {
  const { publicKey } = await getPushPublicKey()
  if (!publicKey) return 'unavailable'
  if ((await Notification.requestPermission()) !== 'granted') return 'denied'

  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }))
  await savePushSubscription(subscription.toJSON())
  return 'enabled'
}

/**
 * Reenvia a inscrição que o navegador já tem: cobre outro usuário entrando
 * no mesmo navegador. Devolve se o push está ativo aqui.
 */
export async function resyncPush(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== 'granted') return false
  const subscription = await currentSubscription()
  if (!subscription) return false
  await savePushSubscription(subscription.toJSON())
  return true
}

/** Ao sair da conta: este navegador para de receber os avisos dela. */
export async function disablePush(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const subscription = await currentSubscription()
    if (!subscription) return
    await removePushSubscription(subscription.endpoint).catch(() => {})
    await subscription.unsubscribe()
  } catch {
    // Push é acessório: nunca trava a saída.
  }
}
