// Service worker só para os avisos: mostra o push e abre o app no clique.
// Sem cache offline de propósito.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'myFinances', {
        body: data.body,
        icon: '/icon-192.png',
        tag: data.id,
      })
      // Abas abertas recarregam o sininho na hora.
      const tabs = await self.clients.matchAll({ type: 'window' })
      for (const tab of tabs) tab.postMessage({ type: 'notification' })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      if (tabs.length > 0) return tabs[0].focus()
      return self.clients.openWindow('/')
    })(),
  )
})
