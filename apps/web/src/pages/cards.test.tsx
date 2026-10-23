import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type CardsResponse, listCards, updateCardCycle } from '@/http/cards'

import { CardDetail } from './card-detail'
import { Cards } from './cards'

vi.mock('@/http/cards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/cards')>()),
  listCards: vi.fn(),
  updateCardCycle: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const tx = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-05',
  amountCents: -12000,
  isTransfer: false,
  installmentNumber: null,
  totalInstallments: null,
  description: 'Loja',
  ...over,
})

const bill = (over: Record<string, unknown> = {}) => ({
  accountId: 'a1',
  closeDate: '2026-10-10',
  dueDate: '2026-10-17',
  amountCents: 50000,
  paidCents: 10000,
  remainingCents: 40000,
  status: 'OPEN',
  transactions: [
    tx({
      description: 'Notebook',
      installmentNumber: 2,
      totalInstallments: 10,
    }),
  ],
  ...over,
})

const data: CardsResponse = {
  cards: [
    {
      account: {
        id: 'a1',
        name: 'Nubank Roxinho',
        number: '1234',
        balanceCents: 0,
        closingDay: 10,
        dueDay: 17,
      },
      bills: [bill() as never],
    },
  ],
  cardsMissingCycle: [],
}

function renderPage(response: CardsResponse = data, path = '/cartoes') {
  vi.mocked(listCards).mockResolvedValue(response)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/cartoes" element={<Cards />} />
          <Route path="/cartoes/:id" element={<CardDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Cards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateCardCycle).mockResolvedValue(undefined)
  })

  it('shows each card with its open bill and opens its entries on click', async () => {
    const user = userEvent.setup()
    renderPage()
    const card = await screen.findByRole('link', { name: /Nubank Roxinho/ })
    expect(card).toHaveTextContent('•••• 1234')
    expect(card).toHaveTextContent('Fatura aberta')
    expect(card).toHaveTextContent('R$ 500,00')
    await user.click(card)
    expect(
      await screen.findByRole('heading', { name: 'Nubank Roxinho' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Notebook')).toBeInTheDocument()
  })

  it('shows the installment as n/total and the bill summary', async () => {
    renderPage(data, '/cartoes/a1')
    expect(await screen.findByText('Notebook')).toBeInTheDocument()
    expect(screen.getByText('2/10')).toBeInTheDocument()
    expect(screen.getByText('17/10/2026')).toBeInTheDocument()
    expect(screen.getByText('R$ 400,00')).toBeInTheDocument()
  })

  it('says so when the card does not exist', async () => {
    renderPage(data, '/cartoes/zz')
    expect(
      await screen.findByText('Cartão não encontrado.'),
    ).toBeInTheDocument()
  })

  it('saves the cycle sending closingDay and dueDay', async () => {
    const user = userEvent.setup()
    renderPage(data, '/cartoes/a1')
    await user.click(
      await screen.findByRole('button', {
        name: 'Ajustar fechamento/vencimento de Nubank Roxinho',
      }),
    )
    const closing = await screen.findByLabelText('Dia de fechamento')
    const due = screen.getByLabelText('Dia de vencimento')
    await user.clear(closing)
    await user.type(closing, '5')
    await user.clear(due)
    await user.type(due, '12')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(updateCardCycle).toHaveBeenCalledWith('a1', {
        closingDay: 5,
        dueDay: 12,
      }),
    )
  })

  it('rejects a day out of 1..31', async () => {
    const user = userEvent.setup()
    renderPage({
      cards: [],
      cardsMissingCycle: [{ id: 'c9', name: 'Inter Gold' }],
    })
    expect(await screen.findByText('Inter Gold')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Dia de fechamento'), '32')
    await user.type(screen.getByLabelText('Dia de vencimento'), '10')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(updateCardCycle).not.toHaveBeenCalled()
  })

  it('lists cards missing the cycle first and asks for both days', async () => {
    const user = userEvent.setup()
    renderPage({
      ...data,
      cardsMissingCycle: [{ id: 'c9', name: 'Inter Gold' }],
    })
    const missing = await screen.findByText('Inter Gold')
    const other = screen.getByText('Nubank Roxinho')
    expect(
      missing.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await user.type(screen.getByLabelText('Dia de fechamento'), '3')
    await user.type(screen.getByLabelText('Dia de vencimento'), '11')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(updateCardCycle).toHaveBeenCalledWith('c9', {
        closingDay: 3,
        dueDay: 11,
      }),
    )
  })
})
