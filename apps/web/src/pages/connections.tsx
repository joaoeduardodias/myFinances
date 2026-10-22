import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type Connection,
  createConnection,
  deleteConnection,
  listConnections,
  syncConnection,
} from '@/http/connections'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import { getErrorStatus } from '@/http/get-error-status'
import { formatDateTimeToDate } from '@/lib/format'
import { zodResolver } from '@/lib/zod-resolver'

const DAY_MS = 86_400_000
const CONSENT_WARNING_DAYS = 30

const STATUS_LABELS: Record<string, string> = {
  UPDATED: 'Atualizada',
  UPDATING: 'Atualizando',
  OUTDATED: 'Desatualizada',
  LOGIN_ERROR: 'Erro de login',
  WAITING_USER_INPUT: 'Aguardando ação',
}

const saoPauloDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

const schema = z.object({
  itemId: z.string().trim().uuid({ message: 'itemId inválido' }),
})

type FormData = z.infer<typeof schema>

const CONNECTION_KEYS = ['connections', 'accounts', 'transactions', 'dashboard']

function AddConnectionForm() {
  const queryClient = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const create = useMutation({
    mutationFn: (itemId: string) => createConnection(itemId),
    onSuccess: async () => {
      reset()
      await Promise.all(
        CONNECTION_KEYS.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
    onError: async (error) => {
      if (getErrorStatus(error) === 409) {
        setFormError('Esta conexão já está cadastrada')
      } else {
        setFormError(
          await getApiErrorMessage(
            error,
            'Não foi possível adicionar a conexão. Tente novamente.',
          ),
        )
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Adicionar conexão</CardTitle>
        <CardDescription>
          O Meu Pluggy permite até 5 conexões e só uso pessoal.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Conecte seus bancos em meu.pluggy.ai.</li>
          <li>
            No Dashboard da Pluggy, abra Applications → sua aplicação → Demo →
            Connect Account → MeuPluggy.
          </li>
          <li>Copie o itemId de cada banco e cole aqui.</li>
        </ol>

        <form
          noValidate
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={handleSubmit(({ itemId }) => {
            setFormError(null)
            create.mutate(itemId)
          })}
        >
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="itemId">itemId</Label>
            <Input
              id="itemId"
              autoComplete="off"
              aria-invalid={errors.itemId ? true : undefined}
              {...register('itemId')}
            />
            {errors.itemId && (
              <p role="alert" className="text-destructive text-sm">
                {errors.itemId.message}
              </p>
            )}
            {formError && (
              <p role="alert" className="text-destructive text-sm">
                {formError}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={create.isPending}
            className="sm:mt-[1.375rem]"
          >
            Adicionar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ConnectionItem({
  connection,
  onRemove,
}: {
  connection: Connection
  onRemove: (c: Connection) => void
}) {
  const queryClient = useQueryClient()
  const sync = useMutation({
    mutationFn: (id: string) => syncConnection(id),
    onSuccess: () =>
      Promise.all(
        CONNECTION_KEYS.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível sincronizar agora. Tente novamente.',
        ),
      ),
  })

  const expiresAt = connection.consentExpiresAt
  const expiresSoon =
    expiresAt !== null &&
    new Date(expiresAt).getTime() - Date.now() < CONSENT_WARNING_DAYS * DAY_MS

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{connection.connectorName}</span>
          <Badge variant="outline">
            {STATUS_LABELS[connection.status] ?? connection.status}
          </Badge>
        </div>
        {expiresAt && (
          <p
            className={
              expiresSoon
                ? 'text-destructive flex items-center gap-1'
                : 'text-muted-foreground'
            }
          >
            {expiresSoon && <TriangleAlert className="size-4" aria-hidden />}
            <span className={expiresSoon ? 'text-destructive' : undefined}>
              {`Autorização vence em ${formatDateTimeToDate(expiresAt)}`}
            </span>
          </p>
        )}
        <p className="text-muted-foreground">
          {connection.lastSyncedAt
            ? `Última sincronização: ${saoPauloDateTime.format(new Date(connection.lastSyncedAt))}`
            : 'Ainda não sincronizada'}
        </p>
        {connection.lastError && (
          <p className="text-muted-foreground break-words">
            <span>Último erro:</span> <span>{connection.lastError}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={sync.isPending}
          aria-label={`Sincronizar ${connection.connectorName}`}
          onClick={() => sync.mutate(connection.id)}
        >
          <RefreshCw
            className={sync.isPending ? 'animate-spin' : ''}
            aria-hidden
          />
          Sincronizar
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Remover ${connection.connectorName}`}
          onClick={() => onRemove(connection)}
        >
          <Trash2 aria-hidden />
          Remover
        </Button>
      </div>
    </li>
  )
}

export function Connections() {
  const queryClient = useQueryClient()
  const [toRemove, setToRemove] = useState<Connection | null>(null)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['connections'],
    queryFn: listConnections,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteConnection(id),
    onSuccess: () =>
      Promise.all(
        CONNECTION_KEYS.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    onError: () =>
      toast.error('Não foi possível remover a conexão. Tente novamente.'),
  })

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Conexões</h1>

      {isPending && <Skeleton className="h-32" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar as conexões.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && data.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nenhuma conexão cadastrada.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {data.map((c) => (
            <ConnectionItem key={c.id} connection={c} onRemove={setToRemove} />
          ))}
        </ul>
      )}

      <AddConnectionForm />

      <AlertDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`Remover ${toRemove?.connectorName ?? 'conexão'}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isto apaga as contas deste banco, todas as transações delas, as
              faturas do cartão e as recorrentes dessas contas. Esta ação não
              pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => toRemove && remove.mutate(toRemove.id)}
            >
              Remover e apagar dados
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
