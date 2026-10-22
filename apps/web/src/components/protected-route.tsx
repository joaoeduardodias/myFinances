import { Loader2Icon } from 'lucide-react'
import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { hasSession } from '@/lib/cookies'

function SessionLoading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2Icon
        role="status"
        aria-label="Carregando sessão"
        className="text-muted-foreground size-6 animate-spin"
      />
    </div>
  )
}

function SessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">
          Não foi possível carregar sua sessão
        </h1>
        <p className="text-muted-foreground text-sm">
          Verifique a conexão e tente de novo.
        </p>
      </div>
      <Button onClick={onRetry}>Tentar de novo</Button>
    </div>
  )
}

export function ProtectedRoute() {
  const { isLoading, hasFailed, refresh } = useAuth()

  if (!hasSession()) return <Navigate to="/login" replace />
  if (isLoading) return <SessionLoading />
  if (hasFailed) return <SessionError onRetry={refresh} />

  return <Outlet />
}
