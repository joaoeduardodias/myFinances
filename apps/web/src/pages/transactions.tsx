import {
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ManualTransactionDialog } from '@/components/manual-transaction-dialog'
import { NativeSelect } from '@/components/native-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  deleteTransaction,
  listAccounts,
  listCategories,
  listTransactions,
  setTransactionCategory,
  setTransactionTransfer,
  type Transaction,
  type TransactionKind,
} from '@/http/transactions'
import { formatBRL, formatDate } from '@/lib/format'
import { currentMonthRange } from '@/lib/period'

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'income', label: 'Entradas' },
  { value: 'expense', label: 'Saídas' },
  { value: 'transfer', label: 'Transferências' },
]

const incomeClass = 'text-emerald-600 dark:text-emerald-400'

function amountClass(t: Transaction) {
  return t.amountCents < 0 ? 'text-destructive' : incomeClass
}

export function Transactions() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()

  const month = currentMonthRange()
  const from = params.get('from') || month.from
  const to = params.get('to') || month.to
  const accountId = params.get('accountId') || undefined
  const category = params.get('category') || undefined
  const kind = (params.get('kind') as TransactionKind | null) || undefined
  const page = Math.max(1, Number(params.get('page')) || 1)

  function setFilter(key: string, value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }

  function setPage(value: number) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('page', String(value))
        return next
      },
      { replace: true },
    )
  }

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
  })
  const filters = { from, to, accountId, category, kind, page }
  const list = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => listTransactions(filters),
  })

  function invalidate(...keys: QueryKey[]) {
    return Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    )
  }

  const changeCategory = useMutation({
    mutationFn: (v: { id: string; category: string }) =>
      setTransactionCategory(v.id, v.category),
    onSuccess: () => invalidate(['transactions']),
    onError: () =>
      toast.error('Não foi possível alterar a categoria. Tente novamente.'),
  })
  const changeTransfer = useMutation({
    mutationFn: (v: { id: string; isTransfer: boolean }) =>
      setTransactionTransfer(v.id, v.isTransfer),
    onSuccess: () => invalidate(['transactions'], ['dashboard']),
    onError: () =>
      toast.error('Não foi possível alterar a transferência. Tente novamente.'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onSuccess: () => invalidate(['transactions'], ['dashboard'], ['accounts']),
    onError: () =>
      toast.error('Não foi possível excluir o lançamento. Tente novamente.'),
  })

  const categoryNames = categories.data ?? []

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Transações</h1>
        <ManualTransactionDialog />
      </div>

      <form
        className="grid grid-cols-2 gap-3 lg:grid-cols-5"
        onSubmit={(e) => e.preventDefault()}
        aria-label="Filtros"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-from">De</Label>
          <Input
            id="filter-from"
            type="date"
            value={from}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-to">Até</Label>
          <Input
            id="filter-to"
            type="date"
            value={to}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-account">Conta</Label>
          <NativeSelect
            id="filter-account"
            value={accountId ?? ''}
            onChange={(e) => setFilter('accountId', e.target.value)}
          >
            <option value="">Todas</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Categoria</Label>
          <NativeSelect
            id="filter-category"
            value={category ?? ''}
            onChange={(e) => setFilter('category', e.target.value)}
          >
            <option value="">Todas</option>
            <option value="none">Sem categoria</option>
            {categoryNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-kind">Tipo</Label>
          <NativeSelect
            id="filter-kind"
            value={kind ?? ''}
            onChange={(e) => setFilter('kind', e.target.value)}
          >
            <option value="">Todos</option>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </form>

      {list.isPending && <Skeleton className="h-64" aria-busy="true" />}
      {list.isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar as transações.</p>
          <Button variant="outline" size="sm" onClick={() => list.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {list.data && list.data.transactions.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nenhuma transação neste período.
        </p>
      )}
      {list.data && list.data.transactions.length > 0 && (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums">
                      {formatDate(t.date)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{t.description}</span>
                        {t.isTransfer && (
                          <Badge variant="secondary">Transferência</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{t.account.name}</TableCell>
                    <TableCell>
                      <NativeSelect
                        aria-label={`Categoria de ${t.description}`}
                        className="min-w-36"
                        value={t.category ?? ''}
                        onChange={(e) =>
                          changeCategory.mutate({
                            id: t.id,
                            category: e.target.value,
                          })
                        }
                      >
                        {!t.category && (
                          <option value="" disabled>
                            Sem categoria
                          </option>
                        )}
                        {t.category && !categoryNames.includes(t.category) && (
                          <option value={t.category}>{t.category}</option>
                        )}
                        {categoryNames.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </NativeSelect>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={amountClass(t)}>
                        {formatBRL(t.amountCents)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`${
                            t.isTransfer
                              ? 'Desfazer transferência'
                              : 'Marcar como transferência'
                          }: ${t.description}`}
                          onClick={() =>
                            changeTransfer.mutate({
                              id: t.id,
                              isTransfer: !t.isTransfer,
                            })
                          }
                        >
                          {t.isTransfer ? 'Desfazer' : 'Transferência'}
                        </Button>
                        {t.source === 'MANUAL' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Excluir: ${t.description}`}
                            onClick={() => remove.mutate(t.id)}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <nav
            aria-label="Paginação"
            className="flex items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={list.data.page <= 1}
              onClick={() => setPage(list.data.page - 1)}
            >
              Anterior
            </Button>
            <span className="text-muted-foreground text-sm">
              {`Página ${list.data.page} de ${list.data.totalPages}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={list.data.page >= list.data.totalPages}
              onClick={() => setPage(list.data.page + 1)}
            >
              Próxima
            </Button>
          </nav>
        </>
      )}
    </div>
  )
}
