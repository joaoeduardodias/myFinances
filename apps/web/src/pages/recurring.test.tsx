import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRecurrence,
  deleteRecurrence,
  dismissLinkSuggestion,
  dismissRecurrence,
  getRecurrence,
  linkTransactions,
  listLinkCandidates,
  listRecurrences,
  type Recurrence,
  type RecurrenceDetail,
  unlinkTransaction,
  updateRecurrence,
} from '@/http/recurrences'
import { listAccounts } from '@/http/transactions'

import { Recurring } from './recurring'

vi.mock('@/http/recurrences', () => ({
  listRecurrences: vi.fn(),
  createRecurrence: vi.fn(),
  updateRecurrence: vi.fn(),
  dismissRecurrence: vi.fn(),
  getRecurrence: vi.fn(),
  deleteRecurrence: vi.fn(),
  listLinkCandidates: vi.fn(),
  linkTransactions: vi.fn(),
  unlinkTransaction: vi.fn(),
  dismissLinkSuggestion: vi.fn(),
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
  kind: 'MONTHLY',
  remainingInstallments: null,
  payrollDeduction: false,
  payrollSourceId: null,
  payrollSource: null,
  account: { name: 'Nubank', type: 'BANK' },
  paidOff: false,
  monthStatus: null,
  linkedCount: 0,
  lastLinkedDate: null,
  loan: null,
  ...over,
})

const detail = (over: Partial<RecurrenceDetail> = {}): RecurrenceDetail => ({
  recurrence: rec({ status: 'CONFIRMED' }),
  months: [
    { month: '2026-05', amountCents: 5590 },
    { month: '2026-06', amountCents: 5590 },
    { month: '2026-07', amountCents: 5590 },
    { month: '2026-08', amountCents: 5590 },
    { month: '2026-09', amountCents: 5590 },
    { month: '2026-10', amountCents: 0 },
  ],
  linked: {
    total: 1,
    items: [
      {
        id: 't1',
        date: '2026-09-15',
        description: 'NETFLIX.COM',
        amountCents: -5590,
        account: { name: 'Nubank' },
      },
    ],
  },
  suggestions: [
    {
      id: 't2',
      date: '2026-10-15',
      description: 'NETFLIX.COM',
      amountCents: -5590,
      account: { name: 'Nubank' },
    },
  ],
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
    vi.mocked(deleteRecurrence).mockResolvedValue(undefined)
    vi.mocked(linkTransactions).mockResolvedValue({ linked: 1, similar: 0 })
    vi.mocked(unlinkTransaction).mockResolvedValue(undefined)
    vi.mocked(dismissLinkSuggestion).mockResolvedValue(undefined)
    vi.mocked(getRecurrence).mockResolvedValue(detail())
    vi.mocked(listLinkCandidates).mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 30,
      items: [],
    })
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
        kind: 'MONTHLY',
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
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Qualquer conta', 'Nubank', 'Carteira']),
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
    // A linha abre o detalhe; o Editar fica lá dentro.
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
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

  it('groups active recurrences by kind and shows the month status', async () => {
    renderPage([
      rec({
        id: 'r1',
        status: 'CONFIRMED',
        monthStatus: { state: 'PAID', date: '2026-10-10', days: 0 },
      }),
      rec({
        id: 'r2',
        description: 'Salário',
        direction: 'IN',
        status: 'CONFIRMED',
        expectedAmountCents: 300000,
        monthStatus: { state: 'DUE', date: '2026-11-05', days: 5 },
      }),
      rec({
        id: 'r3',
        description: 'Empréstimo Caixa',
        kind: 'LOAN',
        status: 'CONFIRMED',
        expectedAmountCents: 48000,
        monthStatus: { state: 'LATE', date: '2026-10-28', days: 3 },
        loan: { remaining: 8, remainingCents: 384000, endMonth: '2027-06' },
      }),
      rec({
        id: 'r4',
        description: 'Vale-alimentação',
        kind: 'EXTERNAL',
        direction: 'IN',
        status: 'CONFIRMED',
        accountId: null,
        account: null,
        expectedAmountCents: 90000,
      }),
    ])

    const bills = await screen.findByRole('region', { name: /Contas do mês/ })
    expect(within(bills).getByText('Netflix')).toBeInTheDocument()
    expect(within(bills).getByText('pago 10/10')).toBeInTheDocument()

    const incomes = screen.getByRole('region', { name: /Recebimentos/ })
    expect(within(incomes).getByText('previsto em 5 dias')).toBeInTheDocument()

    const loans = screen.getByRole('region', { name: /Empréstimos/ })
    expect(within(loans).getByText('atrasado 3 dias')).toBeInTheDocument()
    expect(
      within(loans).getByText(
        /faltam 8 parcelas · R\$ 3\.840,00 · até jun\/27/,
      ),
    ).toBeInTheDocument()

    const external = screen.getByRole('region', { name: /Fora da Pluggy/ })
    expect(within(external).getByText('Vale-alimentação')).toBeInTheDocument()
    expect(within(external).getByText(/Qualquer conta/)).toBeInTheDocument()

    // Indicadores: o VA entra no que entra, não no que sai.
    expect(screen.getByText('Sai por mês').parentElement).toHaveTextContent(
      'R$ 535,90',
    )
    expect(screen.getByText('Entra por mês').parentElement).toHaveTextContent(
      'R$ 3.900,00',
    )
    expect(screen.getByText('Pago este mês').parentElement).toHaveTextContent(
      '1 de 3',
    )
  })

  it('filters by search and lists paid-off loans in their own tab', async () => {
    const user = userEvent.setup()
    renderPage([
      rec({ id: 'r1', status: 'CONFIRMED' }),
      rec({ id: 'r2', description: 'Spotify', status: 'CONFIRMED' }),
      rec({
        id: 'r3',
        description: 'Empréstimo antigo',
        kind: 'LOAN',
        status: 'PAID_OFF',
        paidOff: true,
      }),
    ])
    await user.type(await screen.findByLabelText('Buscar recorrente'), 'spot')
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument()
    expect(screen.getByText('Spotify')).toBeInTheDocument()
    expect(screen.queryByText('Empréstimo antigo')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Buscar recorrente'))
    await user.click(screen.getByRole('button', { name: /Quitados/ }))
    expect(await screen.findByText('Empréstimo antigo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Reabrir/ }))
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r3', {
        status: 'CONFIRMED',
      }),
    )
  })

  it('expands a row with history, linked transactions and the look-alike', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    const row = await screen.findByRole('button', { name: /Netflix/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(getRecurrence).toHaveBeenCalledWith('r1')

    expect(
      await screen.findByRole('img', { name: /Últimos 6 meses/ }),
    ).toBeInTheDocument()
    const linked = screen.getByRole('list', { name: 'Transações vinculadas' })
    expect(within(linked).getByText(/15\/09\/2026/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'Desvincular NETFLIX.COM de 15/09/2026',
      }),
    )
    await waitFor(() =>
      expect(unlinkTransaction).toHaveBeenCalledWith('r1', 't1'),
    )

    await user.click(screen.getByRole('button', { name: 'Vincular' }))
    await waitFor(() =>
      expect(linkTransactions).toHaveBeenCalledWith('r1', ['t2']),
    )
    await user.click(screen.getByRole('button', { name: 'Não é' }))
    await waitFor(() =>
      expect(dismissLinkSuggestion).toHaveBeenCalledWith('r1', 't2'),
    )
  })

  it('picks transactions in the dialog and saves added and removed links', async () => {
    const user = userEvent.setup()
    vi.mocked(listLinkCandidates).mockResolvedValue({
      total: 2,
      page: 1,
      pageSize: 30,
      items: [
        {
          id: 't1',
          date: '2026-09-15',
          description: 'NETFLIX.COM',
          amountCents: -5590,
          account: { name: 'Nubank' },
          linkedTo: { id: 'r1', description: 'Netflix' },
          linkedHere: true,
        },
        {
          id: 't3',
          date: '2026-08-15',
          description: 'PIX NETFLIX',
          amountCents: -5590,
          account: { name: 'Caixa' },
          linkedTo: { id: 'r9', description: 'Outro' },
          linkedHere: false,
        },
      ],
    })
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Escolher transações' }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/de: Outro/)).toBeInTheDocument()
    const linkedBox = within(dialog).getByRole('checkbox', {
      name: /NETFLIX\.COM/,
    })
    expect(linkedBox).toBeChecked()
    await user.click(linkedBox)
    await user.click(
      within(dialog).getByRole('checkbox', { name: /PIX NETFLIX/ }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Salvar vínculos' }),
    )

    await waitFor(() =>
      expect(linkTransactions).toHaveBeenCalledWith('r1', ['t3']),
    )
    expect(unlinkTransaction).toHaveBeenCalledWith('r1', 't1')
  })

  it('searches candidates on the server', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Escolher transações' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Buscar transação'), 'pix')
    await waitFor(() =>
      expect(listLinkCandidates).toHaveBeenLastCalledWith('r1', {
        search: 'pix',
        page: 1,
      }),
    )
  })

  it('deletes only after confirming', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(await screen.findByRole('button', { name: 'Apagar' }))
    const alert = await screen.findByRole('alertdialog')
    expect(alert).toHaveTextContent(/as transações continuam/i)
    expect(deleteRecurrence).not.toHaveBeenCalled()
    await user.click(within(alert).getByRole('button', { name: 'Apagar' }))
    await waitFor(() => expect(deleteRecurrence).toHaveBeenCalledWith('r1'))
  })

  it('pays off a loan by hand', async () => {
    const user = userEvent.setup()
    const loan = rec({
      kind: 'LOAN',
      status: 'CONFIRMED',
      description: 'Empréstimo',
    })
    vi.mocked(getRecurrence).mockResolvedValue(detail({ recurrence: loan }))
    renderPage([loan])
    await user.click(await screen.findByRole('button', { name: /Empréstimo/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Marcar como quitado' }),
    )
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r1', {
        status: 'PAID_OFF',
      }),
    )
  })

  it('creates a loan without account and with remaining installments', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    await user.selectOptions(await screen.findByLabelText('Tipo'), 'LOAN')
    await user.type(screen.getByLabelText('Descrição'), 'Empréstimo Dr Paulo')
    await user.type(screen.getByLabelText('Valor (R$)'), '500,00')
    await user.type(screen.getByLabelText('Dia'), '5')
    await user.type(screen.getByLabelText('Parcelas que faltam'), '8')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(createRecurrence).toHaveBeenCalledWith({
        kind: 'LOAN',
        description: 'Empréstimo Dr Paulo',
        direction: 'OUT',
        expectedAmountCents: 50000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 5,
        nonBusinessDayPolicy: 'ANTICIPATE',
        remainingInstallments: 8,
      }),
    )
  })

  it('rejects zero remaining installments', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    await user.selectOptions(await screen.findByLabelText('Tipo'), 'LOAN')
    await user.type(screen.getByLabelText('Descrição'), 'Empréstimo')
    await user.type(screen.getByLabelText('Valor (R$)'), '500,00')
    await user.type(screen.getByLabelText('Dia'), '5')
    await user.type(screen.getByLabelText('Parcelas que faltam'), '0')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Informe de 1 a 600 parcelas',
      ),
    ).toBeInTheDocument()
    expect(createRecurrence).not.toHaveBeenCalled()
  })

  it('moves a recurrence to another account or to any account when editing', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(await screen.findByRole('button', { name: /^Editar/ }))
    const select = await screen.findByLabelText('Conta')
    await waitFor(() => expect(select).toHaveValue('a1'))
    await user.selectOptions(select, '')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(updateRecurrence).toHaveBeenCalledWith('r1', {
        description: 'Netflix',
        expectedAmountCents: 5590,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 15,
        nonBusinessDayPolicy: 'ANTICIPATE',
        accountId: null,
      }),
    )
  })

  it('keeps the pager in place even with a single page, so the dialog does not jump', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Escolher transações' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Página 1 de 1')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Anterior' }),
    ).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: 'Próxima' }),
    ).toBeDisabled()
  })

  it('creates a payroll-deducted loan, with no account and always as an outflow', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    await user.selectOptions(await screen.findByLabelText('Tipo'), 'LOAN')
    await user.click(screen.getByLabelText('Descontado em folha'))
    expect(screen.queryByLabelText('Conta')).not.toBeInTheDocument()
    // A direção continua no lugar, travada em Saída: sem buraco no layout.
    expect(screen.getByLabelText('Direção')).toBeDisabled()
    expect(screen.getByLabelText('Direção')).toHaveValue('OUT')
    await user.type(screen.getByLabelText('Descrição'), 'Consignado')
    await user.type(screen.getByLabelText('Valor (R$)'), '300,00')
    await user.type(screen.getByLabelText('Dia'), '5')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(createRecurrence).toHaveBeenCalledWith({
        kind: 'LOAN',
        description: 'Consignado',
        direction: 'OUT',
        expectedAmountCents: 30000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 5,
        nonBusinessDayPolicy: 'ANTICIPATE',
        payrollDeduction: true,
      }),
    )
  })

  it('shows payroll loans as such and keeps them out of "Sai por mês"', async () => {
    renderPage([
      rec({ id: 'r1', status: 'CONFIRMED' }),
      rec({
        id: 'r2',
        description: 'Consignado',
        kind: 'LOAN',
        status: 'CONFIRMED',
        payrollDeduction: true,
        accountId: null,
        account: null,
        expectedAmountCents: 30000,
      }),
    ])
    const loans = await screen.findByRole('region', { name: /Empréstimos/ })
    expect(within(loans).getByText(/Descontado em folha/)).toBeInTheDocument()
    expect(screen.getByText('Sai por mês').parentElement).toHaveTextContent(
      'R$ 55,90',
    )
  })

  it('asks for salary credits when linking a payroll loan', async () => {
    const user = userEvent.setup()
    const loan = rec({
      kind: 'LOAN',
      status: 'CONFIRMED',
      description: 'Consignado',
      payrollDeduction: true,
    })
    vi.mocked(getRecurrence).mockResolvedValue(
      detail({ recurrence: loan, suggestions: [] }),
    )
    vi.mocked(listLinkCandidates).mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 10,
      items: [
        {
          id: 's1',
          date: '2026-10-06',
          description: 'RECEBIMENTO TED SALARIO',
          amountCents: 300000,
          account: { name: 'Caixa' },
          linkedTo: null,
          linkedHere: false,
        },
      ],
    })
    renderPage([loan])
    await user.click(await screen.findByRole('button', { name: /Consignado/ }))
    await user.click(
      await screen.findByRole('button', { name: 'Escolher transações' }),
    )
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/crédito do salário/i)
    await user.click(
      await within(dialog).findByRole('checkbox', { name: /SALARIO/ }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Salvar vínculos' }),
    )
    await waitFor(() =>
      expect(linkTransactions).toHaveBeenCalledWith('r1', ['s1']),
    )
  })

  it('a payroll loan follows the chosen salary instead of asking for a day', async () => {
    const user = userEvent.setup()
    renderPage([
      rec({
        id: 'salary',
        description: 'RECEBIMENTO TED SALARIO',
        direction: 'IN',
        status: 'CONFIRMED',
        expectedAmountCents: 297000,
        dayRule: 'NTH_BUSINESS_DAY',
        dayValue: 4,
      }),
      rec({
        id: 'vale',
        description: 'RECEBIMENTO TED SALARIO (Vale)',
        direction: 'IN',
        status: 'CONFIRMED',
        expectedAmountCents: 168900,
        dayValue: 20,
      }),
    ])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    await user.selectOptions(await screen.findByLabelText('Tipo'), 'LOAN')
    await user.click(screen.getByLabelText('Descontado em folha'))
    expect(screen.queryByLabelText('Dia')).not.toBeInTheDocument()
    const source = screen.getByLabelText('Descontado de')
    // Sem escolha, vale o salário de maior valor.
    expect(source).toHaveValue('salary')
    await user.selectOptions(source, 'vale')
    await user.type(screen.getByLabelText('Descrição'), 'Consignado')
    await user.type(screen.getByLabelText('Valor (R$)'), '300,00')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(createRecurrence).toHaveBeenCalledWith({
        kind: 'LOAN',
        description: 'Consignado',
        direction: 'OUT',
        expectedAmountCents: 30000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 20,
        nonBusinessDayPolicy: 'ANTICIPATE',
        payrollDeduction: true,
        payrollSourceId: 'vale',
      }),
    )
  })

  it('shows which salary a payroll loan is deducted from', async () => {
    renderPage([
      rec({
        id: 'r2',
        description: 'Consignado',
        kind: 'LOAN',
        status: 'CONFIRMED',
        payrollDeduction: true,
        payrollSourceId: 'salary',
        payrollSource: { id: 'salary', description: 'Salário' },
      }),
    ])
    const loans = await screen.findByRole('region', { name: /Empréstimos/ })
    expect(
      within(loans).getByText(/Descontado em folha \(Salário\)/),
    ).toBeInTheDocument()
  })

  it('a late income reads as not received, not as an overdue debt', async () => {
    renderPage([
      rec({
        id: 'r1',
        description: 'Salário',
        direction: 'IN',
        status: 'CONFIRMED',
        monthStatus: { state: 'LATE', date: '2026-10-07', days: 24 },
      }),
    ])
    const incomes = await screen.findByRole('region', { name: /Recebimentos/ })
    expect(
      within(incomes).getByText('não recebido há 24 dias'),
    ).toBeInTheDocument()
    expect(within(incomes).queryByText(/atrasado/)).not.toBeInTheDocument()
  })

  it('keeps the direction as a locked select when editing', async () => {
    const user = userEvent.setup()
    renderPage([rec({ status: 'CONFIRMED', direction: 'IN' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(await screen.findByRole('button', { name: /^Editar/ }))
    const direction = await screen.findByLabelText('Direção')
    expect(direction.tagName).toBe('SELECT')
    expect(direction).toBeDisabled()
    expect(direction).toHaveValue('IN')
  })

  it('offers payroll deduction for monthly outflows, not for incomes', async () => {
    const user = userEvent.setup()
    renderPage([])
    await user.click(
      await screen.findByRole('button', { name: 'Novo recorrente' }),
    )
    expect(await screen.findByLabelText('Tipo')).toHaveValue('MONTHLY')
    await user.selectOptions(screen.getByLabelText('Direção'), 'IN')
    expect(
      screen.queryByLabelText('Descontado em folha'),
    ).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Direção'), 'OUT')
    await user.click(screen.getByLabelText('Descontado em folha'))
    await user.type(screen.getByLabelText('Descrição'), 'Plano de saúde')
    await user.type(screen.getByLabelText('Valor (R$)'), '250,00')
    await user.type(screen.getByLabelText('Dia'), '5')
    await user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(createRecurrence).toHaveBeenCalledWith({
        kind: 'MONTHLY',
        description: 'Plano de saúde',
        direction: 'OUT',
        expectedAmountCents: 25000,
        dayRule: 'DAY_OF_MONTH',
        dayValue: 5,
        nonBusinessDayPolicy: 'ANTICIPATE',
        payrollDeduction: true,
      }),
    )
  })

  it('says how many look-alikes came along when linking one transaction', async () => {
    const user = userEvent.setup()
    vi.mocked(linkTransactions).mockResolvedValue({ linked: 1, similar: 2 })
    renderPage([rec({ status: 'CONFIRMED' })])
    await user.click(await screen.findByRole('button', { name: /Netflix/ }))
    await user.click(await screen.findByRole('button', { name: 'Vincular' }))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        '3 transações vinculadas (2 parecidas).',
      ),
    )
  })
})
