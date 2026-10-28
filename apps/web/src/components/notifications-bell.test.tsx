import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AppNotification,
  getNotifications,
  markNotificationsRead,
} from '@/http/notifications'

import { NotificationsBell } from './notifications-bell'

vi.mock('@/http/notifications', () => ({
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}))

const item = (over: Partial<AppNotification>): AppNotification => ({
  id: 'n1',
  kind: 'CATEGORY_WARNING',
  title: 'Mercado em 80%',
  body: 'Você usou 80% do limite.',
  createdAt: '2026-10-20T15:00:00.000Z',
  read: false,
  ...over,
})

function setup(unreadCount: number, notifications: AppNotification[]) {
  vi.mocked(getNotifications).mockResolvedValue({ unreadCount, notifications })
  vi.mocked(markNotificationsRead).mockResolvedValue()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NotificationsBell />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('NotificationsBell', () => {
  it('mostra o número de não lidos no badge', async () => {
    setup(3, [item({})])
    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('mostra 9+ acima de 9', async () => {
    setup(12, [item({})])
    expect(await screen.findByText('9+')).toBeInTheDocument()
  })

  it('não mostra badge com 0 não lidos', async () => {
    setup(0, [item({ read: true })])
    await waitFor(() => expect(getNotifications).toHaveBeenCalled())
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument()
  })

  it('abrir o menu lista os avisos e marca como lidos uma vez', async () => {
    setup(2, [item({}), item({ id: 'n2', title: 'Lazer estourou' })])
    await screen.findByText('2')
    await userEvent.click(screen.getByRole('button', { name: /^Avisos/ }))
    expect(await screen.findByText('Mercado em 80%')).toBeInTheDocument()
    expect(screen.getByText('Lazer estourou')).toBeInTheDocument()
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1))
  })

  it('não marca como lidos com 0 não lidos', async () => {
    setup(0, [item({ read: true })])
    await waitFor(() => expect(getNotifications).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: /^Avisos/ }))
    expect(await screen.findByText('Mercado em 80%')).toBeInTheDocument()
    expect(markNotificationsRead).not.toHaveBeenCalled()
  })

  it('o nome acessível traz a contagem de não lidos', async () => {
    setup(3, [item({})])
    expect(
      await screen.findByRole('button', { name: 'Avisos (3 não lidos)' }),
    ).toBeInTheDocument()
  })

  it('o nome acessível é só Avisos com 0 não lidos', async () => {
    setup(0, [])
    expect(screen.getByRole('button', { name: 'Avisos' })).toBeInTheDocument()
  })

  it('lista vazia mostra mensagem', async () => {
    setup(0, [])
    await userEvent.click(screen.getByRole('button', { name: /^Avisos/ }))
    expect(await screen.findByText('Nenhum aviso.')).toBeInTheDocument()
  })
})
