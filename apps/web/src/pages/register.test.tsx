import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/components/theme-provider'
import { createUser, signInWithPassword } from '@/http/auth'

import { Register } from './register'

vi.mock('@/http/auth', () => ({
  createUser: vi.fn(),
  signInWithPassword: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const signIn = vi.fn()
vi.mock('@/auth/auth-context', () => ({ useAuth: () => ({ signIn }) }))

function renderRegister() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<p>início</p>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

async function fill(password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Nome'), 'Ana')
  await user.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
  await user.type(screen.getByLabelText('Senha'), password)
  await user.click(screen.getByRole('button', { name: 'Criar conta' }))
}

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a password shorter than 8 characters', async () => {
    renderRegister()

    await fill('1234567')

    expect(
      await screen.findByText('A senha deve ter no mínimo 8 caracteres'),
    ).toBeInTheDocument()
    expect(createUser).not.toHaveBeenCalled()
  })

  it('creates the user, signs in and navigates to /', async () => {
    vi.mocked(createUser).mockResolvedValue()
    vi.mocked(signInWithPassword).mockResolvedValue({ token: 'a-token' })
    renderRegister()

    await fill('12345678')

    await waitFor(() => expect(screen.getByText('início')).toBeInTheDocument())
    expect(createUser).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@exemplo.com',
      password: '12345678',
    })
    expect(signIn).toHaveBeenCalledWith('a-token')
  })
})
