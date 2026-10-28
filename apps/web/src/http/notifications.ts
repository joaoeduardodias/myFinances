import { api } from './api'

export type NotificationKind =
  | 'SPENDABLE_NEGATIVE'
  | 'CATEGORY_WARNING'
  | 'CATEGORY_EXCEEDED'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: string
  read: boolean
}

export interface NotificationList {
  unreadCount: number
  notifications: AppNotification[]
}

export function getNotifications() {
  return api.get('notifications').json<NotificationList>()
}

export async function markNotificationsRead() {
  await api.post('notifications/read')
}
