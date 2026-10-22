import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type Dashboard, getDashboard, syncAll } from '@/http/dashboard'

import { Home } from './home'

vi.mock('@/http/dashboard', () => ({
  getDashboard: vi.fn(),
  syncAll: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const base: Dashboard = {
  today: '2026-10-22',
  balanceCents: 250000,
  nextIncome: {
    recurrenceId: 'r1',
    description: 'Salário',
    date: '2026-11-05',
    amountCents: 500000,
  },
  windowEnd: '2026-11-05',
  days: 15,
  noIncomeConfigured: false,
  payables: [
    {
      kind: 'BILL',
      refId: 'b1',
      description: 'Cartão Nubank',
      dueDate: '2026-10-28',
      amountCents: 180000,
    },
  ],
  payableTotalCents: 180000,
  availableCents: 70000,
  perDayCents: 4666,
  cardsMissingCycle: [],
}

function renderHome(data: Partial<Dashboard> = {}) {
  vi.mocked(getDashboard).mockResolvedValue({ ...base, ...data })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Home', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(syncAll).mockResolvedValue({ synced: 0 })
  })

  it('shows what can be spent and the per-day line', async () => {
    renderHome()
    expect(await screen.findByText('R$ 700,00')).toBeInTheDocument()
    expect(
      screen.getByText('R$ 46,66/dia até Salário (05/11/2026)'),
    ).toBeInTheDocument()
    expect(screen.getByText('R$ 2.500,00')).toBeInTheDocument()
    expect(screen.getByText('A pagar até 05/11/2026')).toBeInTheDocument()
    expect(screen.getByText('Cartão Nubank')).toBeInTheDocument()
  })

  it('paints a negative amount as destructive', async () => {
    renderHome({ availableCents: -5000 })
    const value = await screen.findByText('-R$ 50,00')
    expect(value).toHaveClass('text-destructive')
  })

  it('does not paint a positive amount as destructive', async () => {
    renderHome()
    expect(await screen.findByText('R$ 700,00')).not.toHaveClass(
      'text-destructive',
    )
  })

  it('warns when no income is configured and falls back to end of month', async () => {
    renderHome({
      noIncomeConfigured: true,
      nextIncome: null,
      windowEnd: '2026-10-31',
    })
    expect(
      await screen.findByText(/Confirme seu salário em/),
    ).toHaveTextContent(
      'Confirme seu salário em Recorrentes para a projeção ir até o próximo recebimento',
    )
    expect(screen.getByRole('link', { name: /Recorrentes/ })).toHaveAttribute(
      'href',
      '/recorrentes',
    )
    expect(screen.getByText('A pagar até 31/10/2026')).toBeInTheDocument()
    expect(
      screen.getByText('R$ 46,66/dia até o fim do mês (31/10/2026)'),
    ).toBeInTheDocument()
  })

  it('warns about cards missing a cycle', async () => {
    renderHome({ cardsMissingCycle: [{ id: 'c1', name: 'Nubank' }] })
    expect(
      await screen.findByRole('link', { name: /Cartões/ }),
    ).toHaveAttribute('href', '/cartoes')
  })

  it('shows empty state for payables', async () => {
    renderHome({ payables: [], payableTotalCents: 0 })
    expect(await screen.findByText('Nada a pagar até lá')).toBeInTheDocument()
  })

  it('offers retry on error', async () => {
    vi.mocked(syncAll).mockReturnValue(new Promise(() => {}))
    vi.mocked(getDashboard).mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Home />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    vi.mocked(getDashboard).mockResolvedValue(base)
    await user.click(
      await screen.findByRole('button', { name: 'Tentar novamente' }),
    )
    expect(await screen.findByText('R$ 700,00')).toBeInTheDocument()
  })

  it('syncs once on mount and refetches when it ends', async () => {
    renderHome()
    await screen.findByText('R$ 700,00')
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(2))
    expect(syncAll).toHaveBeenCalledTimes(1)
  })

  it('forces a sync from the button', async () => {
    const user = userEvent.setup()
    renderHome()
    await screen.findByText('R$ 700,00')
    await user.click(screen.getByRole('button', { name: 'Sincronizar' }))
    await waitFor(() => expect(syncAll).toHaveBeenCalledWith(true))
  })
})
