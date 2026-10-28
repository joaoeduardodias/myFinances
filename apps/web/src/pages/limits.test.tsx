import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type CategoryLimit,
  declineCategoryLimit,
  getCategoryLimits,
  setCategoryLimit,
} from '@/http/limits'

import { Limits } from './limits'

vi.mock('@/http/limits', () => ({
  getCategoryLimits: vi.fn(),
  setCategoryLimit: vi.fn(),
  declineCategoryLimit: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const limit = (over: Partial<CategoryLimit>): CategoryLimit => ({
  category: 'Mercado',
  status: 'NEW',
  limitCents: null,
  proposedCents: null,
  spentCents: 0,
  ...over,
})

const LIMITS: CategoryLimit[] = [
  limit({ category: 'Mercado', proposedCents: 80000, spentCents: 30000 }),
  limit({ category: 'Delivery', proposedCents: 20000, spentCents: 10000 }),
  limit({
    category: 'Lazer',
    status: 'ACTIVE',
    limitCents: 50000,
    proposedCents: 60000,
    spentCents: 25000,
  }),
  limit({ category: 'Saúde', status: 'ACTIVE', limitCents: 40000 }),
  limit({ category: 'Viagem' }),
  limit({ category: 'Pets', status: 'DECLINED', spentCents: 500 }),
]

function renderPage(limits: CategoryLimit[] = LIMITS) {
  vi.mocked(getCategoryLimits).mockResolvedValue({ month: '2026-10', limits })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Limits />
    </QueryClientProvider>,
  )
}

describe('Limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setCategoryLimit).mockResolvedValue(undefined)
    vi.mocked(declineCategoryLimit).mockResolvedValue(undefined)
  })

  it('accepts a proposal with the proposed amount', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Aceitar Mercado' }),
    )
    await waitFor(() =>
      expect(setCategoryLimit).toHaveBeenCalledWith('Mercado', 80000),
    )
  })

  it('declines a proposal', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Recusar Delivery' }),
    )
    await waitFor(() =>
      expect(declineCategoryLimit).toHaveBeenCalledWith('Delivery'),
    )
  })

  it('keeps the current limit on a review', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Sugestão: R$ 600,00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Manter Lazer' }))
    await waitFor(() =>
      expect(setCategoryLimit).toHaveBeenCalledWith('Lazer', 50000),
    )
  })

  it('uses the suggested amount on a review', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Usar Lazer' }))
    await waitFor(() =>
      expect(setCategoryLimit).toHaveBeenCalledWith('Lazer', 60000),
    )
  })

  it('shows texts for rows without proposal and declined', async () => {
    renderPage()
    expect(await screen.findByText('Sem histórico')).toBeInTheDocument()
    expect(screen.getByText('Sem limite')).toBeInTheDocument()
  })

  it('saves the amount typed in the dialog', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Ajustar Saúde' }),
    )
    const input = screen.getByLabelText('Limite (R$)')
    await user.clear(input)
    await user.type(input, '12,50')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setCategoryLimit).toHaveBeenCalledWith('Saúde', 1250),
    )
  })

  it('prefills the dialog with the current limit or the proposal', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Ajustar Saúde' }),
    )
    expect(screen.getByLabelText('Limite (R$)')).toHaveValue('400,00')
  })

  it('prefills the dialog with the proposal on a new row', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Ajustar Mercado' }),
    )
    expect(screen.getByLabelText('Limite (R$)')).toHaveValue('800,00')
  })

  it('leaves the dialog empty without limit or proposal', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Definir Viagem' }),
    )
    expect(screen.getByLabelText('Limite (R$)')).toHaveValue('')
  })

  it('disables save for an invalid amount', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Definir Viagem' }),
    )
    await user.type(screen.getByLabelText('Limite (R$)'), 'abc')
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled()
  })

  it('removes an active limit', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Remover Saúde' }),
    )
    await waitFor(() =>
      expect(declineCategoryLimit).toHaveBeenCalledWith('Saúde'),
    )
  })

  it('sorts rows by spent amount', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Mercado')
    await user.click(screen.getByRole('button', { name: 'Gasto no mês' }))
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent)
    expect(names()[0]).toBe('Saúde')
    expect(names().at(-1)).toBe('Mercado')
    await user.click(screen.getByRole('button', { name: 'Gasto no mês' }))
    expect(names()[0]).toBe('Mercado')
  })
})
