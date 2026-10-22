import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

export type Theme = 'dark' | 'light' | 'system'

// A mesma chave e o mesmo padrão vivem no script inline do index.html, que
// aplica a classe antes do React montar para o tema claro não piscar.
export const THEME_STORAGE_KEY = 'myfinances-theme'
const DEFAULT_THEME: Theme = 'dark'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
  } catch {
    // Armazenamento bloqueado (janela privada): segue o padrão.
  }
  return DEFAULT_THEME
}

// As mesmas cores das metas do index.html (fundo de cada tema).
const THEME_COLORS = { light: '#ffffff', dark: '#09090b' }

/**
 * O index.html traz uma meta por esquema do sistema, para antes do React. O
 * tema escolhido pode não ser o do sistema: fica uma meta só, sem `media`,
 * com a cor do tema ativo.
 */
function applyThemeColor(isDark: boolean) {
  const [meta, ...extra] = document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )
  extra.forEach((m) => m.remove())
  const target =
    meta ?? document.head.appendChild(document.createElement('meta'))
  target.name = 'theme-color'
  target.removeAttribute('media')
  target.content = isDark ? THEME_COLORS.dark : THEME_COLORS.light
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.classList.toggle('dark', isDark)
  applyThemeColor(isDark)
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return

    // 'system' acompanha o sistema operacional enquanto a aba está aberta.
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Sem persistência o tema vale só para esta sessão.
    }
    setThemeState(next)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>')
  }
  return ctx
}
