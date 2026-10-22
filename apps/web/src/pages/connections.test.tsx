import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HTTPError } from 'ky'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type Connection,
  createConnection,
  deleteConnection,
  listConnections,
  syncConnection,
} from '@/http/connections'

import { Connections } from './connections'

vi.mock('@/http/connections', () => ({
  listConnections: vi.fn(),
  createConnection: vi.fn(),
  syncConnection: vi.fn(),
  deleteConnection: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const UUID = '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c3d'

function httpError(status: number, message: string) {
  return new HTTPError(
    new Response(JSON.stringify({ message }), { status }),
    new Request('http://x'),
    {} as never,
  )
}

const conn: Connection = {
  id: 'c1',
  connectorName: 'Nubank',
  status: 'UPDATED',
  consentExpiresAt: '2099-01-10T00:00:00.000Z',
  lastSyncedAt: '2026-10-21T12:00:00.000Z',
  lastError: null,
}

function renderPage(connections: Connection[] = [conn]) {
  vi.mocked(listConnections).mockResolvedValue(connections)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <Connections />
    </QueryClientProvider>,
  )
}

describe('Connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createConnection).mockResolvedValue(undefined)
    vi.mocked(syncConnection).mockResolvedValue(undefined)
    vi.mocked(deleteConnection).mockResolvedValue(undefined)
  })

  it('shows the fixed instructions and warning', async () => {
    renderPage()
    expect(await screen.findByText('Nubank')).toBeInTheDocument()
    expect(
      screen.getByText('Conecte seus bancos em meu.pluggy.ai.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'No Dashboard da Pluggy, abra Applications → sua aplicação → Demo → Connect Account → MeuPluggy.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Copie o itemId de cada banco e cole aqui.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('O Meu Pluggy permite até 5 conexões e só uso pessoal.'),
    ).toBeInTheDocument()
  })

  it('shows the last error under a label', async () => {
    renderPage([{ ...conn, lastError: 'Connection timed out' }])
    expect(await screen.findByText('Último erro:')).toBeInTheDocument()
    expect(screen.getByText('Connection timed out')).toBeInTheDocument()
  })

  it('warns when consent expires in less than 30 days', async () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString()
    renderPage([{ ...conn, consentExpiresAt: soon }])
    const text = await screen.findByText(/Autorização vence em/)
    expect(text).toHaveClass('text-destructive')
  })

  it('does not warn when consent is far away', async () => {
    renderPage()
    const text = await screen.findByText(/Autorização vence em 10\/01\/2099/)
    expect(text).not.toHaveClass('text-destructive')
  })

  it('rejects an itemId that is not a uuid without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nubank')
    await user.type(screen.getByLabelText('itemId'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(await screen.findByText('itemId inválido')).toBeInTheDocument()
    expect(createConnection).not.toHaveBeenCalled()
  })

  it('creates a connection with a valid itemId', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nubank')
    await user.type(screen.getByLabelText('itemId'), UUID)
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(createConnection).toHaveBeenCalledWith(UUID))
  })

  it('explains a 409', async () => {
    vi.mocked(createConnection).mockRejectedValue(httpError(409, 'dup'))
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nubank')
    await user.type(screen.getByLabelText('itemId'), UUID)
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(
      await screen.findByText('Esta conexão já está cadastrada'),
    ).toBeInTheDocument()
  })

  it('shows the API message on a 400', async () => {
    vi.mocked(createConnection).mockRejectedValue(
      httpError(400, 'Item não encontrado na Pluggy'),
    )
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Nubank')
    await user.type(screen.getByLabelText('itemId'), UUID)
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(
      await screen.findByText('Item não encontrado na Pluggy'),
    ).toBeInTheDocument()
  })

  it('syncs a connection', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Sincronizar Nubank' }),
    )
    await waitFor(() => expect(syncConnection).toHaveBeenCalledWith('c1'))
  })

  it('asks for confirmation before removing', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Remover Nubank' }),
    )
    expect(deleteConnection).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remover' }))
    await waitFor(() => expect(deleteConnection).toHaveBeenCalledWith('c1'))
  })
})
