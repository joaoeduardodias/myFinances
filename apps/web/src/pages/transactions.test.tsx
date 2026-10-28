import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createManualTransaction,
  deleteTransaction,
  listAccounts,
  listCategories,
  listTransactions,
  setTransactionCategory,
  setTransactionTransfer,
} from '@/http/transactions'

import { Transactions } from './transactions'

vi.mock('@/http/transactions', () => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTransactions: vi.fn(),
  setTransactionCategory: vi.fn(),
  setTransactionTransfer: vi.fn(),
  createManualTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function tx(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    date: '2026-10-20',
    description: 'Mercado',
    amountCents: -5000,
    category: 'Restaurante',
    isTransfer: false,
    source: 'PLUGGY',
    account: { name: 'Nubank', type: 'BANK' },
    ...over,
  }
}

function renderPage(transactions = [tx()], totalPages = 1) {
  vi.mocked(listAccounts).mockResolvedValue([])
  vi.mocked(listCategories).mockResolvedValue(['Restaurante', 'Uber e táxi'])
  vi.mocked(listTransactions).mockResolvedValue({
    transactions,
    page: 1,
    totalPages,
  } as never)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Transactions />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setTransactionCategory).mockResolvedValue(undefined)
    vi.mocked(setTransactionTransfer).mockResolvedValue(undefined)
    vi.mocked(createManualTransaction).mockResolvedValue(undefined)
    vi.mocked(deleteTransaction).mockResolvedValue(undefined)
  })

  it('lists transactions with signed, colored amounts', async () => {
    renderPage([
      tx(),
      tx({ id: 't2', description: 'Salário', amountCents: 100000 }),
    ])
    expect(await screen.findByText('Mercado')).toBeInTheDocument()
    expect(screen.getByText('-R$ 50,00')).toHaveClass('text-destructive')
    expect(screen.getByText('R$ 1.000,00')).not.toHaveClass('text-destructive')
    expect(screen.getAllByText('20/10/2026')).toHaveLength(2)
  })

  it('changes the category through the API', async () => {
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByRole('combobox', {
      name: 'Categoria de Mercado',
    })
    await user.selectOptions(select, 'Uber e táxi')
    await waitFor(() =>
      expect(setTransactionCategory).toHaveBeenCalledWith('t1', 'Uber e táxi'),
    )
  })

  it('toggles the transfer flag', async () => {
    const user = userEvent.setup()
    renderPage([tx({ isTransfer: true })])
    expect(await screen.findByText('Transferência')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Desfazer transferência: Mercado' }),
    )
    await waitFor(() =>
      expect(setTransactionTransfer).toHaveBeenCalledWith('t1', false),
    )
  })

  it('sends a negative amount for a manual expense of 20,00', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    await user.click(screen.getByRole('button', { name: 'Lançar manualmente' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Descrição'), 'Café')
    await user.type(within(dialog).getByLabelText('Valor (R$)'), '20,00')
    await user.click(
      within(dialog).getByRole('button', { name: 'Lançar saída' }),
    )
    await waitFor(() =>
      expect(createManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'Café', amountCents: -2000 }),
      ),
    )
  })

  it('sends a positive amount when income is chosen', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    await user.click(screen.getByRole('button', { name: 'Lançar manualmente' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Descrição'), 'Venda')
    await user.type(within(dialog).getByLabelText('Valor (R$)'), '1.234,56')
    await user.click(within(dialog).getByRole('radio', { name: 'Entrada' }))
    await user.click(
      within(dialog).getByRole('button', { name: 'Lançar entrada' }),
    )
    await waitFor(() =>
      expect(createManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ amountCents: 123456 }),
      ),
    )
  })

  it('sends the chosen category with a manual entry', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    await user.click(screen.getByRole('button', { name: 'Lançar manualmente' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Descrição'), 'Feira')
    await user.type(within(dialog).getByLabelText('Valor (R$)'), '50,00')
    await user.selectOptions(
      within(dialog).getByLabelText('Categoria'),
      'Restaurante',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Lançar saída' }),
    )
    await waitFor(() =>
      expect(createManualTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Restaurante' }),
      ),
    )
  })

  it('does not submit an invalid amount', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    await user.click(screen.getByRole('button', { name: 'Lançar manualmente' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Descrição'), 'X')
    await user.click(
      within(dialog).getByRole('button', { name: 'Lançar saída' }),
    )
    expect(
      await within(dialog).findByText('Informe um valor válido'),
    ).toBeInTheDocument()
    expect(createManualTransaction).not.toHaveBeenCalled()
  })

  it('only offers delete for manual transactions', async () => {
    const user = userEvent.setup()
    renderPage([tx(), tx({ id: 't2', description: 'Pix', source: 'MANUAL' })])
    await screen.findByText('Pix')
    expect(screen.getAllByRole('button', { name: /^Excluir/ })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Excluir: Pix' }))
    expect(deleteTransaction).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith('t2'))
  })

  it('shows an alert on load failure', async () => {
    vi.mocked(listAccounts).mockResolvedValue([])
    vi.mocked(listCategories).mockResolvedValue([])
    vi.mocked(listTransactions).mockRejectedValue(new Error('x'))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Transactions />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as transações',
    )
  })

  it('paginates', async () => {
    const user = userEvent.setup()
    renderPage([tx()], 3)
    await screen.findByText('Mercado')
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    )
  })

  it('sorts by the clicked column on the server', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    expect(listTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { column: 'date', order: 'desc' } }),
    )
    const header = screen.getByRole('columnheader', { name: 'Valor' })
    await user.click(within(header).getByRole('button'))
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: { column: 'amount', order: 'asc' },
          page: 1,
        }),
      ),
    )
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    await user.click(within(header).getByRole('button'))
    await waitFor(() =>
      expect(listTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: { column: 'amount', order: 'desc' } }),
      ),
    )
  })
})
