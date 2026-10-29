import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { cloneElement, type ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type Analysis,
  type AnalysisTransaction,
  getAnalysis,
  getTransactionSimilar,
  listAnalysisTransactions,
  listCategoryNecessities,
  saveTransactionRecurrence,
  setCategoryNecessity,
  setTransactionDescription,
  setTransactionNecessity,
} from '@/http/analysis'
import { listCategories, setTransactionCategory } from '@/http/transactions'

import { AnalysisPage } from './analysis'

vi.mock('@/http/analysis', () => ({
  getAnalysis: vi.fn(),
  listAnalysisTransactions: vi.fn(),
  setTransactionNecessity: vi.fn(),
  setTransactionDescription: vi.fn(),
  getTransactionSimilar: vi.fn(),
  saveTransactionRecurrence: vi.fn(),
  listCategoryNecessities: vi.fn(),
  setCategoryNecessity: vi.fn(),
}))
vi.mock('@/http/transactions', () => ({
  listCategories: vi.fn(),
  setTransactionCategory: vi.fn(),
}))
// O jsdom não mede layout: o gráfico precisa de um tamanho fixo para desenhar as barras.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) =>
    cloneElement(children, { width: 900, height: 360 } as object),
}))

const months = Array.from({ length: 12 }, (_, i) => ({
  month: `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, '0')}`,
  incomeCents: 100000,
  essentialCents: 40000,
  avoidableCents: 10000,
  emergencyCents: 0,
  debtCents: 0,
  unclassifiedCents: 0,
  investedCents: 0,
}))

const base: Analysis = {
  from: '2025-11-01',
  to: '2026-10-27',
  month: null,
  months,
  totals: {
    incomeCents: 1300000,
    essentialCents: 600000,
    avoidableCents: 200000,
    emergencyCents: 0,
    debtCents: 100000,
    unclassifiedCents: 100000,
    investedCents: 0,
  },
  categories: [
    {
      category: 'Mercado',
      group: 'essential',
      totalCents: 500000,
      averageCents: 41667,
      count: 30,
    },
    {
      category: 'Lazer',
      group: 'avoidable',
      totalCents: 200000,
      averageCents: 16667,
      count: 5,
    },
    {
      category: 'Saúde',
      group: 'essential',
      totalCents: -3000,
      averageCents: -250,
      count: 2,
    },
  ],
  topExpenses: [],
  topAvoidable: [],
  uncategorized: { count: 0, totalCents: 0 },
}

function Where() {
  const { search } = useLocation()
  return <output data-testid="search">{search}</output>
}

function renderPage(data: Partial<Analysis> = {}, url = '/analise') {
  vi.mocked(getAnalysis).mockResolvedValue({ ...base, ...data })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AnalysisPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function categoryOrder() {
  const table = screen.getByRole('table', { name: /para onde foi/i })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0].textContent)
}

const detailRows: AnalysisTransaction[] = [
  {
    id: 't1',
    date: '2026-10-20',
    description: 'Supermercado Dia',
    amountCents: -15000,
    category: 'Mercado',
    necessity: null,
    accountName: 'Conta Itaú',
    group: 'essential',
    categoryLocked: false,
  },
  {
    id: 't2',
    date: '2026-10-21',
    description: 'Compra no cartão',
    amountCents: -8000,
    category: 'Mercado',
    necessity: 'AVOIDABLE',
    accountName: 'Cartão Nubank',
    group: 'avoidable',
    categoryLocked: false,
  },
  {
    id: 't3',
    date: '2026-10-22',
    description: 'Estorno mercado',
    amountCents: 2000,
    category: 'Mercado',
    necessity: null,
    accountName: 'Conta Itaú',
    group: 'essential',
    categoryLocked: false,
  },
]

describe('AnalysisPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listAnalysisTransactions).mockResolvedValue(detailRows)
    vi.mocked(listCategories).mockResolvedValue(['Mercado', 'Lazer'])
    vi.mocked(setTransactionNecessity).mockResolvedValue(undefined)
    vi.mocked(setTransactionDescription).mockResolvedValue(undefined)
    vi.mocked(saveTransactionRecurrence).mockResolvedValue(undefined)
    vi.mocked(getTransactionSimilar).mockResolvedValue({
      similar: 0,
      canSaveRecurrence: false,
      recurrenceStatus: null,
    })
    vi.mocked(setTransactionCategory).mockResolvedValue(undefined)
    vi.mocked(setCategoryNecessity).mockResolvedValue(undefined)
    vi.mocked(listCategoryNecessities).mockResolvedValue([
      { category: 'Mercado', necessity: 'ESSENTIAL', isDefault: true },
      { category: 'Lazer', necessity: 'AVOIDABLE', isDefault: false },
    ])
  })

  async function openMercado(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Mercado' }))
    return screen.findByRole('table', { name: 'Transações da categoria' })
  }

  it('clicar numa categoria abre o detalhe com as transações dela, inclusive de cartão', async () => {
    const user = userEvent.setup()
    renderPage({}, '/analise?mes=2026-03')
    const table = await openMercado(user)
    expect(listAnalysisTransactions).toHaveBeenCalledWith({
      category: 'Mercado',
      month: '2026-03',
    })
    expect(within(table).getByText('Supermercado Dia')).toBeInTheDocument()
    expect(within(table).getByText('Cartão Nubank')).toBeInTheDocument()
  })

  const gasto = {
    id: 'e1',
    date: '2026-10-10',
    description: 'Oficina',
    amountCents: -30000,
    category: 'Mercado',
    necessity: null,
    accountName: 'Nubank',
    group: 'essential' as const,
  }

  it('clicar em maiores gastos abre a transação e salva descrição e categoria', async () => {
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    const desc = within(dialog).getByLabelText('Descrição')
    await user.clear(desc)
    await user.type(desc, 'Conserto do carro')
    await user.selectOptions(
      within(dialog).getByLabelText('Categoria'),
      'Lazer',
    )
    const callsBefore = vi.mocked(getAnalysis).mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setTransactionDescription).toHaveBeenCalledWith(
        'e1',
        'Conserto do carro',
        false,
      ),
    )
    expect(setTransactionCategory).toHaveBeenCalledWith('e1', 'Lazer', false)
    expect(setTransactionNecessity).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(vi.mocked(getAnalysis).mock.calls.length).toBeGreaterThan(
      callsBefore,
    )
  })

  it('salvar sem mudar nada não chama nenhuma rota', async () => {
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    await user.click(await screen.findByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(setTransactionDescription).not.toHaveBeenCalled()
    expect(setTransactionCategory).not.toHaveBeenCalled()
    expect(setTransactionNecessity).not.toHaveBeenCalled()
  })

  it('descrição com espaços nas pontas e só categoria alterada não chama a rota de descrição', async () => {
    const user = userEvent.setup()
    renderPage({ topExpenses: [{ ...gasto, description: '  Oficina  ' }] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(
      within(dialog).getByLabelText('Categoria'),
      'Lazer',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setTransactionCategory).toHaveBeenCalledWith('e1', 'Lazer', false),
    )
    expect(setTransactionDescription).not.toHaveBeenCalled()
  })

  it('marcar emergência pela janela', async () => {
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(
      within(dialog).getByLabelText('Marca'),
      'Emergência',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setTransactionNecessity).toHaveBeenCalledWith('e1', 'EMERGENCY'),
    )
    expect(setTransactionDescription).not.toHaveBeenCalled()
    expect(setTransactionCategory).not.toHaveBeenCalled()
  })

  it('erro ao salvar mostra aviso e mantém a janela aberta', async () => {
    vi.mocked(setTransactionDescription).mockRejectedValue(new Error('400'))
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Descrição'))
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(setTransactionDescription).toHaveBeenCalled())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('com iguais, o Salvar pergunta antes de aplicar nelas', async () => {
    vi.mocked(getTransactionSimilar).mockResolvedValue({
      similar: 23,
      canSaveRecurrence: true,
      recurrenceStatus: null,
    })
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    const recurrence = await within(dialog).findByLabelText(
      'Salvar como recorrente',
    )
    const desc = within(dialog).getByLabelText('Descrição')
    await user.clear(desc)
    await user.type(desc, 'Parcela do carro')
    await user.selectOptions(
      within(dialog).getByLabelText('Categoria'),
      'Lazer',
    )
    await user.click(recurrence)
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(
      within(dialog).getByText(/Há outras 23 transações iguais/),
    ).toBeInTheDocument()
    expect(setTransactionDescription).not.toHaveBeenCalled()
    await user.click(
      within(dialog).getByRole('button', { name: 'Confirmar para todas' }),
    )
    await waitFor(() =>
      expect(saveTransactionRecurrence).toHaveBeenCalledWith('e1'),
    )
    expect(setTransactionDescription).toHaveBeenCalledWith(
      'e1',
      'Parcela do carro',
      true,
    )
    expect(setTransactionCategory).toHaveBeenCalledWith('e1', 'Lazer', true)
    expect(
      vi.mocked(setTransactionDescription).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(saveTransactionRecurrence).mock.invocationCallOrder[0],
    )
  })

  it('com iguais, "Só nesta" não aplica nelas', async () => {
    vi.mocked(getTransactionSimilar).mockResolvedValue({
      similar: 1,
      canSaveRecurrence: false,
      recurrenceStatus: null,
    })
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(getTransactionSimilar).toHaveBeenCalled())
    await user.selectOptions(
      within(dialog).getByLabelText('Categoria'),
      'Lazer',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await user.click(within(dialog).getByRole('button', { name: 'Só nesta' }))
    await waitFor(() =>
      expect(setTransactionCategory).toHaveBeenCalledWith('e1', 'Lazer', false),
    )
  })

  it('já recorrente aparece marcado e não chama a rota de novo', async () => {
    vi.mocked(getTransactionSimilar).mockResolvedValue({
      similar: 0,
      canSaveRecurrence: true,
      recurrenceStatus: 'CONFIRMED',
    })
    const user = userEvent.setup()
    renderPage({ topExpenses: [gasto] })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    await user.click(within(table).getByText('Oficina'))
    const dialog = await screen.findByRole('dialog')
    const box = await within(dialog).findByLabelText('Já está nos recorrentes')
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saveTransactionRecurrence).not.toHaveBeenCalled()
  })

  it('dava pra evitar abre a mesma janela', async () => {
    const user = userEvent.setup()
    renderPage({
      topAvoidable: [{ ...gasto, id: 'a1', description: 'Cinema' }],
    })
    const table = await screen.findByRole('table', { name: 'Dava pra evitar' })
    await user.click(within(table).getByText('Cinema'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue('Cinema')
  })

  it('linha do detalhe da categoria abre a janela; crédito não tem marca', async () => {
    const user = userEvent.setup()
    renderPage()
    const table = await openMercado(user)
    expect(within(table).queryByRole('combobox')).toBeNull()
    await user.click(within(table).getByText('Estorno mercado'))
    const dialog = await screen.findByRole('dialog', { name: 'Transação' })
    expect(within(dialog).getByLabelText('Descrição')).toHaveValue(
      'Estorno mercado',
    )
    expect(within(dialog).queryByLabelText('Marca')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Transação' })).toBeNull(),
    )

    await user.click(within(table).getByText('Supermercado Dia'))
    const debito = await screen.findByRole('dialog', { name: 'Transação' })
    await user.selectOptions(within(debito).getByLabelText('Marca'), 'Evitável')
    await user.selectOptions(
      within(debito).getByLabelText('Categoria'),
      'Lazer',
    )
    await user.click(within(debito).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(setTransactionNecessity).toHaveBeenCalledWith('t1', 'AVOIDABLE'),
    )
    expect(setTransactionCategory).toHaveBeenCalledWith('t1', 'Lazer', false)
  })

  it('diálogo de padrões salva a troca de uma categoria', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Essencial ou evitável' }),
    )
    expect(
      await screen.findByText(/Mercado/, { selector: 'td' }),
    ).toHaveTextContent('Mercado (padrão)')
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Padrão de Mercado' }),
      'Evitável',
    )
    await waitFor(() =>
      expect(setCategoryNecessity).toHaveBeenCalledWith('Mercado', 'AVOIDABLE'),
    )
  })

  it('mostra entrou, saiu e o percentual evitável', async () => {
    renderPage()
    const kpis = await screen.findByRole('region', { name: 'Indicadores' })
    expect(within(kpis).getByText('R$ 13.000,00')).toBeInTheDocument()
    // Saiu = 6000 + 2000 + 1000 + 1000
    expect(within(kpis).getByText('R$ 10.000,00')).toBeInTheDocument()
    expect(within(kpis).getByText('R$ 2.000,00')).toBeInTheDocument()
    expect(within(kpis).getByText('20% do que saiu')).toBeInTheDocument()
    expect(screen.getByText('nov/2025 – out/2026')).toBeInTheDocument()
  })

  it('mostra o investido à parte, fora do que saiu', async () => {
    renderPage({ totals: { ...base.totals, investedCents: 123400 } })
    const kpis = await screen.findByRole('region', { name: 'Indicadores' })
    expect(within(kpis).getByText('Investido')).toBeInTheDocument()
    expect(within(kpis).getByText('R$ 1.234,00')).toBeInTheDocument()
    // Saiu continua 6000 + 2000 + 1000 + 1000
    expect(within(kpis).getByText('R$ 10.000,00')).toBeInTheDocument()
  })

  it('mostra o aviso de sem categoria só quando há', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Indicadores' })
    expect(screen.queryByText(/sem categoria somando/)).not.toBeInTheDocument()
  })

  it('mostra o aviso quando há transações sem categoria', async () => {
    renderPage({ uncategorized: { count: 3, totalCents: 45050 } })
    expect(
      await screen.findByText('3 transações sem categoria somando R$ 450,50'),
    ).toBeInTheDocument()
  })

  it('clicar num mês filtra pela URL e mostra "Ver 12 meses"', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByRole('region', { name: 'Indicadores' })
    expect(screen.queryByRole('button', { name: 'Ver 12 meses' })).toBeNull()

    const bars = await waitFor(() => {
      const found = container.querySelectorAll('.recharts-bar-rectangle')
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    await user.click(bars[0])

    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent('?mes=2025-11'),
    )
    expect(getAnalysis).toHaveBeenLastCalledWith('2025-11')
    await user.click(
      await screen.findByRole('button', { name: 'Ver 12 meses' }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent(/^$/),
    )
  })

  it('mostra o mês filtrado no cabeçalho', async () => {
    renderPage({ month: '2026-03' }, '/analise?mes=2026-03')
    expect(await screen.findByText('mar/2026')).toBeInTheDocument()
    expect(getAnalysis).toHaveBeenCalledWith('2026-03')
  })

  it('ordena a tabela de categorias ao clicar no cabeçalho', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table', { name: /para onde foi/i })
    expect(categoryOrder()).toEqual(['Mercado', 'Lazer', 'Saúde'])

    await user.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(categoryOrder()).toEqual(['Lazer', 'Mercado', 'Saúde'])
    await user.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(categoryOrder()).toEqual(['Saúde', 'Mercado', 'Lazer'])
  })

  it('valor negativo de categoria aparece com sinal', async () => {
    renderPage()
    expect(await screen.findByText('-R$ 30,00')).toBeInTheDocument()
  })

  it('mostra emergência com o percentual do que saiu', async () => {
    renderPage({
      totals: {
        ...base.totals,
        essentialCents: 6000,
        avoidableCents: 2000,
        emergencyCents: 2000,
        debtCents: 0,
        unclassifiedCents: 0,
      },
    })
    const indicators = await screen.findByRole('region', {
      name: 'Indicadores',
    })
    const saiu = within(indicators)
      .getByText('Saiu')
      .closest('[data-slot="card"]')
    expect(saiu).toHaveTextContent('R$ 100,00')
    const emergencia = within(indicators)
      .getByText('Emergência')
      .closest('[data-slot="card"]')
    expect(emergencia).toHaveTextContent('R$ 20,00')
    expect(emergencia).toHaveTextContent('20%')
  })

  it('nomeia o grupo emergência em Maiores gastos', async () => {
    renderPage({
      topExpenses: [
        {
          id: 'e1',
          date: '2026-10-10',
          description: 'Dentista',
          amountCents: -30000,
          category: 'Lazer',
          necessity: 'EMERGENCY',
          accountName: 'Nubank',
          group: 'emergency',
        },
      ],
    })
    const table = await screen.findByRole('table', { name: 'Maiores gastos' })
    expect(within(table).getByText('Emergência')).toBeInTheDocument()
    const categorias = screen.getByRole('table', { name: /para onde foi/i })
    expect(within(categorias).queryByText('Emergência')).toBeNull()
  })
})
