import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY, ThemeProvider } from './theme-provider'
import { ThemeToggle } from './theme-toggle'

type Listener = () => void
let systemDark = false
let listeners: Listener[] = []

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  systemDark = false
  listeners = []
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return systemDark
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      listeners = listeners.filter((x) => x !== l)
    },
  }))
})

afterEach(() => vi.unstubAllGlobals())

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  )
}

describe('ThemeProvider', () => {
  it('defaults to dark when nothing is stored', () => {
    renderToggle()

    expect(document.documentElement).toHaveClass('dark')
  })

  it('removes the dark class and persists when choosing Claro', async () => {
    const user = userEvent.setup()
    renderToggle()

    await user.click(screen.getByRole('button', { name: 'Alterar tema' }))
    await user.click(screen.getByRole('menuitemradio', { name: /Claro/ }))

    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('follows the system preference, and its changes, on system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system')
    renderToggle()
    expect(document.documentElement).not.toHaveClass('dark')

    act(() => {
      systemDark = true
      listeners.forEach((l) => l())
    })

    expect(document.documentElement).toHaveClass('dark')
  })
})
