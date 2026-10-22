import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'

import { useAuth } from '@/auth/auth-context'
import { AuthShell } from '@/components/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createUser, signInWithPassword } from '@/http/auth'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object({
  name: z.string().trim().min(1, { message: 'Nome obrigatório' }),
  email: z.string().trim().email({ message: 'E-mail inválido' }),
  password: z
    .string()
    .min(8, { message: 'A senha deve ter no mínimo 8 caracteres' }),
})

type FormData = z.infer<typeof schema>

export function Register() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    try {
      await createUser(data)
      const { token } = await signInWithPassword({
        email: data.email,
        password: data.password,
      })
      await signIn(token)
      navigate('/')
    } catch (error) {
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível criar a conta. Tente novamente em instantes.',
        ),
      )
    }
  }

  return (
    <AuthShell
      title="Criar conta"
      description="Comece a organizar suas finanças"
    >
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" autoComplete="name" {...register('name')} />
          {errors.name && (
            <p className="text-destructive text-sm">{errors.name.message}</p>
          )}
        </div>

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
            autoComplete="new-password"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-destructive text-sm">
              {errors.password.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Criando…' : 'Criar conta'}
        </Button>
      </form>

      <p className="text-muted-foreground text-center text-sm">
        Já tem conta?{' '}
        <Link
          to="/login"
          className="text-foreground font-medium underline-offset-4 hover:underline"
        >
          Entrar
        </Link>
      </p>
    </AuthShell>
  )
}
