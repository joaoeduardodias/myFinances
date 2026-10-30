import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DuplicatePayslipError,
  listPayslips,
  type Payslip,
  uploadPayslip,
} from '@/http/payslips'

import { Payslips } from './payslips'

vi.mock('@/http/payslips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/payslips')>()),
  listPayslips: vi.fn(),
  uploadPayslip: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const payslip = (over: Partial<Payslip> = {}): Payslip => ({
  id: 'p1',
  competence: '2026-10',
  type: 'MONTHLY',
  status: 'RECOGNIZED',
  grossCents: 600000,
  netCents: 450000,
  fileName: 'out.pdf',
  createdAt: '2026-10-05T10:00:00.000Z',
  ...over,
})

function Probe() {
  const { id } = useParams()
  return <p>{`Detalhe ${id}`}</p>
}

function renderPage(payslips: Payslip[] = [payslip()]) {
  vi.mocked(listPayslips).mockResolvedValue(payslips)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/holerites']}>
        <Routes>
          <Route path="/holerites" element={<Payslips />} />
          <Route path="/holerites/:id" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function pdf(size = 1000) {
  const file = new File(['x'], 'holerite.pdf', { type: 'application/pdf' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Enviar holerite' }),
  )
}

describe('Payslips', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists payslips with type, status and net amount', async () => {
    renderPage([
      payslip(),
      payslip({
        id: 'p2',
        competence: '2026-09',
        type: 'ADVANCE',
        status: 'UNRECOGNIZED',
        netCents: null,
      }),
    ])
    expect(await screen.findByText('10/2026')).toBeInTheDocument()
    expect(screen.getByText('Reconhecido')).toBeInTheDocument()
    expect(screen.getByText('Não reconhecido')).toBeInTheDocument()
    expect(screen.getByText('R$ 4.500,00')).toBeInTheDocument()
    expect(screen.getByText('Adiantamento')).toBeInTheDocument()
  })

  it('does not call the API for a 6 MB file and shows an error', async () => {
    const user = userEvent.setup()
    renderPage()
    await openDialog(user)
    await user.upload(
      await screen.findByLabelText('Arquivo (PDF ou PNG)'),
      pdf(6 * 1024 * 1024),
    )
    await user.type(screen.getByLabelText('Competência'), '2026-10')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB/)
    expect(uploadPayslip).not.toHaveBeenCalled()
  })

  it('rejects a file that is neither PDF nor PNG before calling the API', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderPage()
    await openDialog(user)
    await user.upload(
      await screen.findByLabelText('Arquivo (PDF ou PNG)'),
      new File(['x'], 'foto.jpg', { type: 'image/jpeg' }),
    )
    await user.type(screen.getByLabelText('Competência'), '2026-10')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/PDF ou PNG/)
    expect(uploadPayslip).not.toHaveBeenCalled()
  })

  it('uploads and goes to the new payslip', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadPayslip).mockResolvedValue(payslip({ id: 'novo' }))
    renderPage()
    await openDialog(user)
    const file = pdf()
    await user.upload(
      await screen.findByLabelText('Arquivo (PDF ou PNG)'),
      file,
    )
    await user.type(screen.getByLabelText('Competência'), '2026-10')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'THIRTEENTH')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(uploadPayslip).toHaveBeenCalledWith({
        competence: '2026-10',
        type: 'THIRTEENTH',
        file,
      }),
    )
    expect(await screen.findByText('Detalhe novo')).toBeInTheDocument()
  })

  it('uploads a PNG print', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadPayslip).mockResolvedValue(payslip({ id: 'print' }))
    renderPage()
    await openDialog(user)
    const file = new File(['x'], 'holerite.png', { type: 'image/png' })
    await user.upload(
      await screen.findByLabelText('Arquivo (PDF ou PNG)'),
      file,
    )
    await user.type(screen.getByLabelText('Competência'), '2026-10')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(uploadPayslip).toHaveBeenCalledWith(
        expect.objectContaining({ file }),
      ),
    )
  })

  it('navigates to the existing payslip on 409', async () => {
    const user = userEvent.setup()
    vi.mocked(uploadPayslip).mockRejectedValue(new DuplicatePayslipError('p9'))
    renderPage()
    await openDialog(user)
    await user.upload(
      await screen.findByLabelText('Arquivo (PDF ou PNG)'),
      pdf(),
    )
    await user.type(screen.getByLabelText('Competência'), '2026-10')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('Detalhe p9')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Este arquivo já foi enviado')
  })
})
