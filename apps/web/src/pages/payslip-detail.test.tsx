import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deletePayslip,
  getPayslip,
  getPayslipFileUrl,
  type PayslipDetailData,
  reprocessPayslip,
  savePayslipLines,
} from '@/http/payslips'

import { PayslipDetail } from './payslip-detail'

vi.mock('@/http/payslips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/payslips')>()),
  getPayslip: vi.fn(),
  savePayslipLines: vi.fn(),
  getPayslipFileUrl: vi.fn(),
  deletePayslip: vi.fn(),
  reprocessPayslip: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const detail = (over: Partial<PayslipDetailData> = {}): PayslipDetailData => ({
  payslip: {
    id: 'p1',
    competence: '2026-10',
    type: 'MONTHLY',
    status: 'RECOGNIZED',
    grossCents: 600000,
    netCents: 450000,
    fileName: 'out.pdf',
    createdAt: '2026-10-05T10:00:00.000Z',
  },
  lines: [
    {
      id: 'l1',
      kind: 'EARNING',
      description: 'Salário',
      reference: '30d',
      amountCents: 600000,
      position: 0,
    },
    {
      id: 'l2',
      kind: 'DEDUCTION',
      description: 'INSS',
      reference: null,
      amountCents: 150000,
      position: 1,
    },
  ],
  reconciliation: {
    matched: true,
    transaction: {
      id: 't1',
      date: '2026-10-05',
      amountCents: 450000,
      description: 'Salário',
    },
  },
  ...over,
})

function renderPage(data: PayslipDetailData) {
  vi.mocked(getPayslip).mockResolvedValue(data)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/holerites/p1']}>
        <Routes>
          <Route path="/holerites/:id" element={<PayslipDetail />} />
          <Route path="/holerites" element={<p>Lista de holerites</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const unrecognized = () =>
  detail({
    payslip: {
      ...detail().payslip,
      status: 'UNRECOGNIZED',
      grossCents: null,
      netCents: null,
    },
    lines: [],
    reconciliation: { matched: false, transaction: null },
  })

describe('PayslipDetail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the reconciliation badge with the deposit date', async () => {
    renderPage(detail())
    expect(
      await screen.findByText('Líquido conferido com o depósito de 05/10/2026'),
    ).toBeInTheDocument()
    expect(screen.getByText('INSS')).toBeInTheDocument()
  })

  it('keeps the payslip order until a column is clicked', async () => {
    const user = userEvent.setup()
    const base = detail()
    renderPage(
      detail({
        lines: [
          base.lines[0],
          {
            ...base.lines[0],
            id: 'l3',
            description: 'Adicional',
            amountCents: 1000,
            position: 2,
          },
        ],
      }),
    )
    const table = (await screen.findByRole('heading', { name: 'Proventos' }))
      .parentElement as HTMLElement
    const descriptions = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(descriptions()).toEqual(['Salário', 'Adicional'])
    await user.click(within(table).getByRole('button', { name: 'Descrição' }))
    expect(descriptions()).toEqual(['Adicional', 'Salário'])
    await user.click(within(table).getByRole('button', { name: 'Descrição' }))
    expect(descriptions()).toEqual(['Salário', 'Adicional'])
  })

  it('shows when the deposit was not found', async () => {
    renderPage(
      detail({ reconciliation: { matched: false, transaction: null } }),
    )
    expect(
      await screen.findByText('Depósito não encontrado'),
    ).toBeInTheDocument()
  })

  // A aba abre no clique (ainda no gesto do usuário, senão o bloqueador de
  // pop-up barra) e só recebe o endereço quando a API responde.
  it('opens the tab on click and points it at the PDF url', async () => {
    const user = userEvent.setup()
    const tab = {
      location: { href: '' },
      opener: {} as unknown,
      close: vi.fn(),
    }
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(tab as unknown as Window)
    let resolveUrl!: (url: string) => void
    vi.mocked(getPayslipFileUrl).mockReturnValue(
      new Promise((resolve) => {
        resolveUrl = resolve
      }),
    )
    renderPage(detail())
    await user.click(await screen.findByRole('button', { name: 'Baixar PDF' }))

    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('')

    resolveUrl('https://files/x.pdf')
    await waitFor(() => expect(tab.location.href).toBe('https://files/x.pdf'))
    expect(tab.close).not.toHaveBeenCalled()
  })

  it('closes the tab when the url request fails', async () => {
    const user = userEvent.setup()
    const tab = { location: { href: '' }, opener: null, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    vi.mocked(getPayslipFileUrl).mockRejectedValue(new Error('falhou'))
    renderPage(detail())
    await user.click(await screen.findByRole('button', { name: 'Baixar PDF' }))

    await waitFor(() => expect(tab.close).toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalled()
  })

  it('sends the lines and net in cents from the editor', async () => {
    const user = userEvent.setup()
    vi.mocked(savePayslipLines).mockResolvedValue({
      payslip: detail().payslip,
      lines: [],
    })
    renderPage(unrecognized())
    expect(
      await screen.findByText(
        'Ainda não sabemos ler este layout — lance os valores abaixo',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Adicionar provento' }))
    await user.type(screen.getByLabelText('Descrição do provento 1'), 'Salário')
    await user.type(screen.getByLabelText('Valor do provento 1'), '6.000,00')
    await user.click(screen.getByRole('button', { name: 'Adicionar desconto' }))
    await user.type(screen.getByLabelText('Descrição do desconto 1'), 'INSS')
    await user.type(screen.getByLabelText('Referência do desconto 1'), '11%')
    await user.type(screen.getByLabelText('Valor do desconto 1'), '1.500,50')
    await user.type(screen.getByLabelText('Bruto (R$)'), '6.000,00')
    await user.type(screen.getByLabelText('Líquido (R$)'), '4.499,50')
    await user.click(screen.getByRole('button', { name: 'Salvar valores' }))

    await waitFor(() =>
      expect(savePayslipLines).toHaveBeenCalledWith('p1', {
        grossCents: 600000,
        netCents: 449950,
        lines: [
          {
            kind: 'EARNING',
            description: 'Salário',
            reference: null,
            amountCents: 600000,
          },
          {
            kind: 'DEDUCTION',
            description: 'INSS',
            reference: '11%',
            amountCents: 150050,
          },
        ],
      }),
    )
  })

  it('requires the net amount in the editor', async () => {
    const user = userEvent.setup()
    renderPage(unrecognized())
    await user.click(
      await screen.findByRole('button', { name: 'Salvar valores' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(/líquido/i)
    expect(savePayslipLines).not.toHaveBeenCalled()
  })

  it('deletes after confirmation and goes back to the list', async () => {
    const user = userEvent.setup()
    vi.mocked(deletePayslip).mockResolvedValue(undefined)
    renderPage(detail())
    await user.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(deletePayslip).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(deletePayslip).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('Lista de holerites')).toBeInTheDocument()
  })

  it('names the download after the file type', async () => {
    renderPage(
      detail({ payslip: { ...detail().payslip, fileName: 'print.png' } }),
    )
    expect(
      await screen.findByRole('button', { name: 'Baixar imagem' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Baixar PDF' }),
    ).not.toBeInTheDocument()
  })

  it('reads an unrecognized payslip again and shows the lines', async () => {
    const user = userEvent.setup()
    vi.mocked(reprocessPayslip).mockResolvedValue({
      payslip: detail().payslip,
      lines: detail().lines,
    })
    renderPage(unrecognized())
    const button = await screen.findByRole('button', { name: 'Ler de novo' })
    vi.mocked(getPayslip).mockResolvedValue(detail())
    await user.click(button)
    await waitFor(() => expect(reprocessPayslip).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('INSS')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Holerite lido.')
  })

  it('asks before reading over lines typed by hand', async () => {
    const user = userEvent.setup()
    vi.mocked(reprocessPayslip).mockResolvedValue({
      payslip: detail().payslip,
      lines: detail().lines,
    })
    renderPage(detail({ payslip: { ...detail().payslip, status: 'MANUAL' } }))
    await user.click(await screen.findByRole('button', { name: 'Ler de novo' }))
    expect(reprocessPayslip).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Ler de novo' }),
    )
    await waitFor(() => expect(reprocessPayslip).toHaveBeenCalledWith('p1'))
  })

  it('does not offer to read a recognized payslip again', async () => {
    renderPage(detail())
    await screen.findByText('INSS')
    expect(
      screen.queryByRole('button', { name: 'Ler de novo' }),
    ).not.toBeInTheDocument()
  })

  it('shows an error when the payslip cannot be read', async () => {
    const user = userEvent.setup()
    vi.mocked(reprocessPayslip).mockRejectedValue(new Error('boom'))
    renderPage(unrecognized())
    await user.click(await screen.findByRole('button', { name: 'Ler de novo' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível ler o holerite. Tente novamente.',
      ),
    )
  })
})
