import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
  banks: {
    totalCents: 100940,
    groups: [
      {
        key: '237',
        kind: 'BANK',
        name: 'Bradesco',
        logoUrl: 'https://cdn.pluggy.ai/assets/connector-icons/203.svg',
        balanceCents: 55823,
        accounts: [
          {
            id: 'a1',
            name: 'Banco Bradesco',
            number: '00029484-5',
            balanceCents: 55823,
          },
          { id: 'a2', name: 'Poupança', number: null, balanceCents: 0 },
        ],
      },
      {
        key: 'wallet',
        kind: 'WALLET',
        name: 'Carteira',
        logoUrl: null,
        balanceCents: -1000,
        accounts: [
          { id: 'w', name: 'Carteira', number: null, balanceCents: -1000 },
        ],
      },
    ],
  },
  cards: {
    totalCents: 488539,
    limitCents: 584707,
    limitUsedCents: 488539,
    items: [
      {
        id: 'k1',
        name: 'CAIXA ELO MAIS INTERNACIONAL',
        number: '0187',
        balanceCents: 423373,
        creditLimitCents: 500000,
      },
      {
        id: 'k2',
        name: 'gold',
        number: '9832',
        balanceCents: 0,
        creditLimitCents: 4707,
      },
    ],
  },
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
  })

  it('shows bank accounts grouped by institution, with share and wallet', async () => {
    renderHome()
    const banks = await screen.findByRole('region', {
      name: 'Contas bancárias',
    })
    expect(within(banks).getByText('R$ 1.009,40')).toBeInTheDocument()
    expect(within(banks).getByText('2 contas · 55,3%')).toBeInTheDocument()
    // O primeiro é o total do grupo; o segundo, a conta dentro dele.
    expect(within(banks).getAllByText('R$ 558,23')[0]).toHaveClass(
      'text-income',
    )
    expect(within(banks).getAllByText('-R$ 10,00')[0]).toHaveClass(
      'text-destructive',
    )
    expect(within(banks).getByText('Banco Bradesco')).not.toBeVisible()
    await userEvent.setup().click(within(banks).getByText('Bradesco'))
    expect(within(banks).getByText('Banco Bradesco')).toBeVisible()
  })

  it('shows credit cards with the used share of the limit', async () => {
    renderHome()
    const cards = await screen.findByRole('region', {
      name: 'Cartões de crédito',
    })
    expect(within(cards).getByText('R$ 4.885,39')).toHaveClass(
      'text-destructive',
    )
    expect(within(cards).getByText('84% utilizado')).toBeInTheDocument()
    expect(within(cards).getByText('Limite: R$ 5.847,07')).toBeInTheDocument()
    expect(within(cards).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '84',
    )
    expect(within(cards).getByText('xxxx 0187')).toBeInTheDocument()
  })

  it('hides the limit bar when no card has a limit', async () => {
    renderHome({
      cards: { ...base.cards, limitCents: null, limitUsedCents: 0 },
    })
    const cards = await screen.findByRole('region', {
      name: 'Cartões de crédito',
    })
    expect(within(cards).queryByRole('progressbar')).not.toBeInTheDocument()
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

  it('shows empty states without accounts or cards', async () => {
    renderHome({
      banks: { totalCents: 0, groups: [] },
      cards: { totalCents: 0, limitCents: null, limitUsedCents: 0, items: [] },
    })
    expect(
      await screen.findByText('Nenhuma conta conectada.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Nenhum cartão de crédito.')).toBeInTheDocument()
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
