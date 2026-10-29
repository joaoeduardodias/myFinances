import {
  keepPreviousData,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ManualTransactionDialog } from '@/components/manual-transaction-dialog'
import { NativeSelect } from '@/components/native-select'
import { SortableHead } from '@/components/sortable-head'
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
  type TransactionSortColumn,
} from '@/http/transactions'
import { formatBRL, formatDate } from '@/lib/format'
import { currentMonthRange } from '@/lib/period'
import { type Sort, toggleSort } from '@/lib/sort'

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'income', label: 'Entradas' },
  { value: 'expense', label: 'Saídas' },
  { value: 'transfer', label: 'Transferências entre contas' },
]

const SORT_COLUMNS: TransactionSortColumn[] = [
  'date',
  'description',
  'account',
  'category',
  'amount',
]

const incomeClass = 'text-income'

function amountClass(t: Transaction) {
  // Transferência só troca o dinheiro de conta: não é gasto nem entrada.
  if (t.isTransfer) return 'text-muted-foreground'
  return t.amountCents < 0 ? 'text-destructive' : incomeClass
}

/** "Nubank → Caixa" na direção do dinheiro; sem par, fica o texto do banco. */
function transferRoute(t: Transaction) {
  if (!t.transferAccount) return t.description
  return t.amountCents < 0
    ? `${t.account.name} → ${t.transferAccount}`
    : `${t.transferAccount} → ${t.account.name}`
}

export function Transactions() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [toDelete, setToDelete] = useState<Transaction | null>(null)

  const month = currentMonthRange()
  const from = params.get('from') || month.from
  const to = params.get('to') || month.to
  const accountId = params.get('accountId') || undefined
  const category = params.get('category') || undefined
  const kind = KINDS.find((k) => k.value === params.get('kind'))?.value
  const page = Math.max(1, Number(params.get('page')) || 1)
  const sort: Sort<TransactionSortColumn> = {
    column: SORT_COLUMNS.find((c) => c === params.get('sort')) ?? 'date',
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
  }

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

  function setSort(column: TransactionSortColumn) {
    const next = toggleSort(sort, column)
    setParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        params.set('sort', next.column)
        params.set('order', next.order)
        params.delete('page')
        return params
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
  const filters = { from, to, accountId, category, kind, page, sort }
  const list = useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => listTransactions(filters),
    // Trocar página ou ordenação mantém a tabela na tela até chegar a nova.
    placeholderData: keepPreviousData,
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
            {accounts.data
              ?.filter((a) => a.type !== 'CREDIT')
              .map((a) => (
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
            {/* Larguras fixas: reordenar troca as linhas e, no layout
                automático, as colunas mudariam de tamanho. A descrição fica
                com o resto, e no celular a tabela rola de lado. */}
            <Table className="min-w-3xl table-fixed">
              <TableHeader>
                <TableRow>
                  <SortableHead
                    column="date"
                    sort={sort}
                    onSort={setSort}
                    className="w-28"
                  >
                    Data
                  </SortableHead>
                  <SortableHead
                    column="description"
                    sort={sort}
                    onSort={setSort}
                  >
                    Descrição
                  </SortableHead>
                  <SortableHead
                    column="account"
                    sort={sort}
                    onSort={setSort}
                    className="hidden w-40 md:table-cell"
                  >
                    Conta
                  </SortableHead>
                  <SortableHead
                    column="category"
                    sort={sort}
                    onSort={setSort}
                    className="w-40"
                  >
                    Categoria
                  </SortableHead>
                  <SortableHead
                    column="amount"
                    sort={sort}
                    onSort={setSort}
                    className="w-32 text-right"
                  >
                    Valor
                  </SortableHead>
                  <TableHead className="w-44">
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
                    <TableCell className="whitespace-normal break-words">
                      {t.isTransfer ? (
                        <div className="flex flex-col">
                          <span>Transferência entre contas</span>
                          <span className="text-muted-foreground text-xs">
                            {transferRoute(t)}
                          </span>
                        </div>
                      ) : (
                        <>
                          <span>{t.description}</span>
                          <span className="block text-muted-foreground text-xs md:hidden">
                            {t.account.name}
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="hidden truncate md:table-cell">
                      {t.account.name}
                    </TableCell>
                    <TableCell>
                      {t.isTransfer ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <NativeSelect
                          aria-label={`Categoria de ${t.description}`}
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
                          {t.category &&
                            !categoryNames.includes(t.category) && (
                              <option value={t.category}>{t.category}</option>
                            )}
                          {categoryNames.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
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
                            onClick={() => setToDelete(t)}
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
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${toDelete?.description ?? ''}" será removido. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && remove.mutate(toDelete.id)}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
