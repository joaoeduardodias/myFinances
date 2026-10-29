import { HTTPError } from 'ky'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

import type { Profile } from '@/http/auth'
import { getProfile, logout as logoutSession } from '@/http/auth'
import { hasSession, setToken } from '@/lib/cookies'
import { disablePush } from '@/lib/push'

import { endSession } from './end-session'

/**
 * `loading` e `error` existem para a falha ao carregar o perfil não ser
 * confundida com "sem sessão": a tela diz o que houve em vez de redirecionar.
 */
type SessionStatus = 'loading' | 'ready' | 'error'

interface AuthContextValue {
  user: Profile | null
  isLoading: boolean
  hasFailed: boolean
  signIn: (token: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isUnauthorized(error: unknown) {
  return error instanceof HTTPError && error.response.status === 401
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [status, setStatus] = useState<SessionStatus>(() =>
    hasSession() ? 'loading' : 'ready',
  )

  const refresh = useCallback(async () => {
    setStatus('loading')
    try {
      const { user } = await getProfile()
      setUser(user)
      setStatus('ready')
    } catch (error) {
      // Token que a API recusa é sessão morta — expirada, revogada, ou assinada
      // com outro JWT_SECRET.
      if (isUnauthorized(error)) {
        endSession()
        return
      }
      // Rede fora ou API com erro não é "sem sessão".
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    if (hasSession()) refresh()
  }, [refresh])

  // O provider fica acima do roteador e nunca remonta na navegação: a sessão
  // iniciada depois da montagem precisa carregar o perfil explicitamente.
  const signIn = useCallback(
    async (token: string) => {
      setToken(token)
      await refresh()
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    // Antes do logout: a remoção na API ainda precisa da sessão.
    await disablePush()
    try {
      await logoutSession()
    } catch {
      // Rede fora ou token já morto não pode travar o logout local.
    }
    endSession()
  }, [])

  const value: AuthContextValue = {
    user,
    isLoading: status === 'loading',
    hasFailed: status === 'error',
    signIn,
    signOut,
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>')
  }
  return ctx
}
