import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createRecurrence,
  dismissRecurrence,
  listRecurrences,
  type Recurrence,
  updateRecurrence,
} from '@/http/recurrences'
import { listAccounts } from '@/http/transactions'

import { Recurring } from './recurring'

vi.mock('@/http/recurrences', () => ({
  listRecurrences: vi.fn(),
  createRecurrence: vi.fn(),
  updateRecurrence: vi.fn(),
  dismissRecurrence: vi.fn(),
}))
vi.mock('@/http/transactions', () => ({ listAccounts: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const rec = (over: Partial<Recurrence> = {}): Recurrence => ({
  id: 'r1',
  accountId: 'a1',
  description: 'Netflix',
  direction: 'OUT',
  expectedAmountCents: 5590,
  dayRule: 'DAY_OF_MONTH',
  dayValue: 15,
  nonBusinessDayPolicy: 'ANTICIPATE',
  status: 'SUGGESTED',
  account: { name: 'Nubank', type: 'BANK' },
  ...over,
})

function account(id: string, type: 'BANK' | 'CREDIT' | 'WALLET', name: string) {
  return {
    id,
    type,
    name,
    number: null,
    balanceCents: 0,
    closingDay: null,
    dueDay: null,
    connectorName: null,
  }
}

function renderPage(recurrences: Recurrence[] = [rec()]) {
  vi.mocked(listRecurrences).mockResolvedValue(recurrences)
  vi.mocked(listAccounts).mockResolvedValue([
    account('a1', 'BANK', 'Nubank'),
    account('card', 'CREDIT', 'Cartão Nubank'),
    account('w', 'WALLET', 'Carteira'),
  ])
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Recurring />
    </QueryClientProvider>,
  )
}

describe('Recurring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createRecurrence).mockResolvedValue(undefined)
    vi.mocked(updateRecurrence).mockResolvedValue(undefined)
    vi.mocked(dismissRecurrence).mockResolvedValue(undefined)
  })

  it('confirms a suggestion sending status CONFIRMED', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Confirmar/ }))
    expect(await screen.findByLabelText('Descrição')).toHaveValue('Netflix')
    expect(screen.getByLabelText('Valor (R$)')).toHaveValue('55,90')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r1', {
        description: 'Netflix',
        expectedAmountCents: 5590,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 15,
        nonBusinessDayPolicy: 'ANTICIPATE',
        status: 'CONFIRMED',
      }),
    )
  })

  it('dismisses a suggestion without confirmation', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Descartar/ }))
    await waitFor(() => expect(dismissRecurrence).toHaveBeenCalledWith('r1'))
  })

  it('hides the weekend policy for the business-day rule', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    expect(
      await screen.findByLabelText('Se cair em fim de semana ou feriado'),
    ).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Regra'), 'NTH_BUSINESS_DAY')
    expect(
      screen.queryByLabelText('Se cair em fim de semana ou feriado'),
    ).not.toBeInTheDocument()
  })

  it('rejects dayValue 32 in the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^Confirmar/ }))
    const day = await screen.findByLabelText('Dia')
    await user.clear(day)
    await user.type(day, '32')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(updateRecurrence).not.toHaveBeenCalled()
  })

  it('creates a new recurrence', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    await user.type(await screen.findByLabelText('Descrição'), 'Aluguel')
    await user.selectOptions(screen.getByLabelText('Conta'), 'a1')
    await user.type(screen.getByLabelText('Valor (R$)'), '1.500,00')
    await user.type(screen.getByLabelText('Dia'), '5')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(createRecurrence).toHaveBeenCalledWith({
        accountId: 'a1',
        description: 'Aluguel',
        direction: 'OUT',
        expectedAmountCents: 150000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 5,
        nonBusinessDayPolicy: 'ANTICIPATE',
      }),
    )
  })

  // A projeção ignora recorrente no cartão: oferecer o cartão criaria uma
  // recorrente que nunca aparece em "a pagar".
  it('offers only bank accounts and the wallet', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    const select = await screen.findByLabelText('Conta')
    await waitFor(() =>
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Selecione',
        'Nubank',
        'Carteira',
      ]),
    )
  })

  it('keeps the discarded section collapsed until opened', async () => {
    const user = userEvent.setup()
    renderPage([rec({ id: 'r2', description: 'Spotify', status: 'DISMISSED' })])
    const toggle = await screen.findByRole('button', { name: /Descartados/ })
    expect(screen.queryByText('Spotify')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(await screen.findByText('Spotify')).toBeInTheDocument()
  })

  it('edits a confirmed recurrence without status, account or direction', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /^Editar/ }))
    const amount = await screen.findByLabelText('Valor (R$)')
    await user.clear(amount)
    await user.type(amount, '60,00')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r1', {
        description: 'Netflix',
        expectedAmountCents: 6000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 15,
        nonBusinessDayPolicy: 'ANTICIPATE',
      }),
    )
  })

  it('reactivates a dismissed recurrence', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'DISMISSED' })])
    await user.click(await screen.findByRole('button', { name: /Descartados/ }))
    await user.click(await screen.findByRole('button', { name: /^Reativar/ }))
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r1', {
        status: 'CONFIRMED',
      }),
    )
  })
})
