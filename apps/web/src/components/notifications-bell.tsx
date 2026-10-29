import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, BellRingIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getNotifications, markNotificationsRead } from '@/http/notifications'
import { formatDateTimeToDate } from '@/lib/format'
import { enablePush, isPushSupported, resyncPush } from '@/lib/push'
import { cn } from '@/lib/utils'

export function NotificationsBell() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: 60_000,
  })
  const markRead = useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  // null = ainda não sabe; o botão de ativar só aparece com `false`.
  const [pushActive, setPushActive] = useState<boolean | null>(null)
  const pushSupported = isPushSupported()

  useEffect(() => {
    if (!pushSupported) return
    resyncPush()
      .then(setPushActive)
      .catch(() => setPushActive(false))
    // O service worker avisa quando chega push com a aba aberta.
    const onMessage = () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    const { serviceWorker } = navigator
    serviceWorker.addEventListener('message', onMessage)
    return () => serviceWorker.removeEventListener('message', onMessage)
  }, [pushSupported, queryClient])

  async function handleEnablePush() {
    try {
      const result = await enablePush()
      if (result === 'enabled') {
        setPushActive(true)
        toast.success('Avisos ativados neste navegador.')
      } else if (result === 'denied') {
        toast.error('O navegador bloqueou as notificações.')
      } else {
        toast.error('Notificações do navegador indisponíveis no servidor.')
      }
    } catch {
      toast.error('Não foi possível ativar as notificações.')
    }
  }

  const unreadCount = data?.unreadCount ?? 0
  const notifications = data?.notifications ?? []

  function handleOpenChange(open: boolean) {
    if (open && unreadCount > 0) markRead.mutate()
  }

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            unreadCount > 0 ? `Avisos (${unreadCount} não lidos)` : 'Avisos'
          }
          className="relative"
        >
          <BellIcon className="size-4" />
          {unreadCount > 0 && (
            <span
              data-testid="notifications-badge"
              className="bg-destructive absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium text-white"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        {notifications.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">Nenhum aviso.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={cn(
                  'space-y-0.5 p-3 text-sm',
                  !n.read && 'bg-accent',
                )}
              >
                <p className={cn(!n.read && 'font-semibold')}>{n.title}</p>
                <p className="text-muted-foreground">{n.body}</p>
                <p className="text-muted-foreground text-xs">
                  {formatDateTimeToDate(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {pushActive === false && (
          <DropdownMenuItem
            className="rounded-none border-t p-3"
            onSelect={handleEnablePush}
          >
            <BellRingIcon />
            Receber avisos no navegador
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
