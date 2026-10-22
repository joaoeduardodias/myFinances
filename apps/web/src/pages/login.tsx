import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInWithPassword } from '@/http/auth'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import { getErrorStatus } from '@/http/get-error-status'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object({
  email: z.string().trim().email({ message: 'E-mail inválido' }),
  password: z.string().min(1, { message: 'Senha obrigatória' }),
})

type FormData = z.infer<typeof schema>

export function Login() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    try {
      const { token } = await signInWithPassword(data)
      await signIn(token)
      navigate('/')
    } catch (error) {
      const status = getErrorStatus(error)
      if (status === undefined) {
        // Sem status HTTP a requisição nem chegou à API: não culpe as credenciais.
        toast.error(
          'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
        )
      } else if (status === 400 || status === 401) {
        toast.error('E-mail ou senha incorretos. Tente novamente.')
      } else {
        toast.error(
          await getApiErrorMessage(
            error,
            'Erro ao entrar. Tente novamente em instantes.',
          ),
        )
      }
    }
  }

  return (
    <AuthShell title="Entrar" description="Acesse sua conta">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-destructive text-sm">{errors.email.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-destructive text-sm">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Não tem conta?{' '}
        <Link
          to="/register"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Criar conta
        </Link>
      </p>
    </AuthShell>
  )
}
