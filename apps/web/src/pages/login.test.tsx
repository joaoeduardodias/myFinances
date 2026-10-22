import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/components/theme-provider'
import { signInWithPassword } from '@/http/auth'

import { Login } from './login'

vi.mock('@/http/auth', () => ({ signInWithPassword: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const signIn = vi.fn()
vi.mock('@/auth/auth-context', () => ({ useAuth: () => ({ signIn }) }))

function renderLogin() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<p>início</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts the credentials, starts the session and navigates to /', async () => {
    vi.mocked(signInWithPassword).mockResolvedValue({ token: 'a-token' })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await user.type(screen.getByLabelText('Senha'), 'senha-segura')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => expect(screen.getByText('início')).toBeInTheDocument())
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ana@exemplo.com',
      password: 'senha-segura',
    })
    expect(signIn).toHaveBeenCalledWith('a-token')
  })

  it('does not call the API with an invalid e-mail', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText('E-mail'), 'invalido')
    await user.type(screen.getByLabelText('Senha'), 'x')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })
})
