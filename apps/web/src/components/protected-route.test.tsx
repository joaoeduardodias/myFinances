import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hasSession } from '@/lib/cookies'

import { ProtectedRoute } from './protected-route'

vi.mock('@/lib/cookies', () => ({ hasSession: vi.fn() }))

let isLoading = false
let hasFailed = false
const refresh = vi.fn()

vi.mock('@/auth/auth-context', () => ({
  useAuth: () => ({ user: null, isLoading, hasFailed, refresh }),
}))

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<p>conteúdo protegido</p>} />
        </Route>
        <Route path="/login" element={<p>tela de login</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    isLoading = false
    hasFailed = false
    vi.mocked(hasSession).mockReturnValue(true)
  })

  it('redirects to /login without a session', () => {
    vi.mocked(hasSession).mockReturnValue(false)

    renderAt('/')

    expect(screen.getByText('tela de login')).toBeInTheDocument()
  })

  it('shows a spinner while the session loads', () => {
    isLoading = true

    renderAt('/')

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('conteúdo protegido')).not.toBeInTheDocument()
  })

  it('offers a retry when the session fails to load', () => {
    hasFailed = true

    renderAt('/')

    expect(screen.getByText('Tentar de novo')).toBeInTheDocument()
  })

  it('renders the content with a session', () => {
    renderAt('/')

    expect(screen.getByText('conteúdo protegido')).toBeInTheDocument()
  })
})
