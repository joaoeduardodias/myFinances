import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAdvisor } from '@/http/advisor'
import { type Dashboard, getDashboard, syncAll } from '@/http/dashboard'

import { Home } from './home'

vi.mock('@/http/dashboard', () => ({
  getDashboard: vi.fn(),
  syncAll: vi.fn(),
}))
vi.mock('@/http/advisor', () => ({
  getAdvisor: vi.fn(() => new Promise(() => {})),
  askAdvisor: vi.fn(),
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
  flow: [
    ...Array.from({ length: 10 }, (_, i) => ({
      month: `2025-${String(i + 11).padStart(2, '0')}`,
      creditCents: 0,
      debitCents: 0,
      cardCents: 0,
    })),
    {
      month: '2026-09',
      creditCents: 400000,
      debitCents: 90000,
      cardCents: 30000,
    },
    {
      month: '2026-10',
      creditCents: 500000,
      debitCents: 120000,
      cardCents: 45000,
    },
  ],
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
    vi.mocked(getAdvisor).mockReturnValue(new Promise(() => {}))
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
    expect(
      within(banks).getByRole('link', { name: /Banco Bradesco/ }),
    ).toHaveAttribute('href', '/transacoes?accountId=a1')
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
    expect(within(cards).getByText('R$ 0,00')).toHaveClass('text-destructive')
    expect(within(cards).getByRole('link', { name: /gold/ })).toHaveAttribute(
      'href',
      '/cartoes/k2',
    )
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

  it('shows the month credits, debits and card purchases against the previous month', async () => {
    renderHome()
    const month = await screen.findByRole('region', {
      name: 'Movimento do mês',
    })
    expect(within(month).getByText('R$ 5.000,00')).toHaveClass('text-income')
    expect(within(month).getByText('R$ 1.200,00')).toHaveClass(
      'text-destructive',
    )
    expect(within(month).getByText('R$ 450,00')).toBeInTheDocument()
    // Crédito subindo é bom; débito subindo é ruim.
    expect(within(month).getByText('+25%')).toHaveClass('text-income')
    expect(within(month).getByText('+33%')).toHaveClass('text-destructive')
    expect(
      within(month).getByText('vs mês anterior (R$ 4.000,00)'),
    ).toBeInTheDocument()
    expect(within(month).getByText('R$ 3.350,00')).toHaveClass('text-income')
    expect(
      screen.getByRole('img', { name: /10\/2026 créditos R\$ 5\.000,00/ }),
    ).toBeInTheDocument()
  })

  it('lists overdue and upcoming payables with links', async () => {
    renderHome({
      payables: [
        {
          kind: 'BILL',
          refId: 'k1:2026-10-10',
          description: 'Fatura Caixa',
          dueDate: '2026-10-10',
          amountCents: 31833,
        },
        {
          kind: 'RECURRENCE',
          refId: 'r9',
          description: 'Aluguel',
          dueDate: '2026-10-22',
          amountCents: 150000,
        },
      ],
      payableTotalCents: 181833,
    })
    const payables = await screen.findByRole('region', { name: 'A pagar' })
    expect(within(payables).getByText('R$ 1.818,33')).toHaveClass(
      'text-destructive',
    )
    const overdue = within(payables).getByRole('region', { name: 'Vencidas' })
    expect(within(overdue).getByText('Venceu há 12 dias')).toHaveClass(
      'text-destructive',
    )
    expect(
      within(overdue).getByRole('link', { name: /Fatura Caixa/ }),
    ).toHaveAttribute('href', '/cartoes/k1')
    const upcoming = within(payables).getByRole('region', { name: 'A vencer' })
    expect(within(upcoming).getByText('Vence hoje')).toBeInTheDocument()
    expect(
      within(upcoming).getByRole('link', { name: /Aluguel/ }),
    ).toHaveAttribute('href', '/recorrentes')
  })

  it('says there is nothing to pay until the window end', async () => {
    renderHome({ payables: [], payableTotalCents: 0 })
    const payables = await screen.findByRole('region', { name: 'A pagar' })
    expect(
      within(payables).getByText('Nada a pagar até 05/11/2026.'),
    ).toBeInTheDocument()
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

  it('refetches the advisor summary when the sync ends', async () => {
    let finishSync: (value: { synced: number }) => void = () => {}
    vi.mocked(syncAll).mockReturnValue(
      new Promise((resolve) => {
        finishSync = resolve
      }),
    )
    vi.mocked(getAdvisor).mockResolvedValue({
      summary: null,
      questionsAvailable: true,
    })
    renderHome()
    await waitFor(() => expect(getAdvisor).toHaveBeenCalledTimes(1))
    finishSync({ synced: 1 })
    await waitFor(() => expect(getAdvisor).toHaveBeenCalledTimes(2))
  })

  it('forces a sync from the button', async () => {
    const user = userEvent.setup()
    renderHome()
    await screen.findByText('R$ 700,00')
    await user.click(screen.getByRole('button', { name: 'Sincronizar' }))
    await waitFor(() => expect(syncAll).toHaveBeenCalledWith(true))
  })
})
