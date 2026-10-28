import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { SortableHead } from '@/components/sortable-head'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  type CategoryLimit,
  declineCategoryLimit,
  getCategoryLimits,
  setCategoryLimit,
} from '@/http/limits'
import { formatBRL } from '@/lib/format'
import { parseReaisToCents } from '@/lib/money'
import { type Sort, sortRows, toggleSort } from '@/lib/sort'

type Column = 'category' | 'spent' | 'limit' | 'usage' | 'proposal'

function usage(l: CategoryLimit) {
  return l.status === 'ACTIVE' && l.limitCents
    ? l.spentCents / l.limitCents
    : null
}

function sortValue(l: CategoryLimit, column: Column) {
  switch (column) {
    case 'category':
      return l.category
    case 'spent':
      return l.spentCents
    case 'limit':
      return l.status === 'ACTIVE' ? l.limitCents : null
    case 'usage':
      return usage(l)
    case 'proposal':
      return l.proposedCents
  }
}

function LimitDialog({
  limit,
  onOpenChange,
}: {
  limit: CategoryLimit | null
  onOpenChange: (open: boolean) => void
}) {
  const [value, setValue] = useState('')
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (cents: number) =>
      setCategoryLimit(limit?.category ?? '', cents),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['category-limits'] })
      onOpenChange(false)
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível salvar o limite. Tente novamente.',
        ),
      ),
  })
  const cents = parseReaisToCents(value)

  return (
    <Dialog open={limit !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Limite de ${limit?.category ?? ''}`}</DialogTitle>
          <DialogDescription>
            Quanto você quer gastar por mês nesta categoria.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (cents !== null) save.mutate(cents)
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="limit-value">Limite (R$)</Label>
            <Input
              id="limit-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={cents === null || save.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Limits() {
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<Sort<Column> | null>(null)
  const [editing, setEditing] = useState<CategoryLimit | null>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['category-limits'],
    queryFn: getCategoryLimits,
  })

  const mutate = useMutation({
    mutationFn: (run: () => Promise<void>) => run(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['category-limits'] }),
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível atualizar o limite. Tente novamente.',
        ),
      ),
  })
  const set = (category: string, cents: number) =>
    mutate.mutate(() => setCategoryLimit(category, cents))
  const clear = (category: string) =>
    mutate.mutate(() => declineCategoryLimit(category))

  const onSort = (column: Column) => setSort((s) => toggleSort(s, column))
  const rows = data
    ? sort
      ? sortRows(data.limits, sort, sortValue)
      : data.limits
    : []
  const busy = mutate.isPending

  function actions(l: CategoryLimit) {
    const c = l.category
    if (l.status === 'NEW' && l.proposedCents !== null) {
      const proposed = l.proposedCents
      return (
        <>
          <Button
            size="sm"
            aria-label={`Aceitar ${c}`}
            disabled={busy}
            onClick={() => set(c, proposed)}
          >
            Aceitar
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Ajustar ${c}`}
            onClick={() => setEditing(l)}
          >
            Ajustar
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Recusar ${c}`}
            disabled={busy}
            onClick={() => clear(c)}
          >
            Recusar
          </Button>
        </>
      )
    }
    if (l.status === 'ACTIVE') {
      const current = l.limitCents
      const proposed = l.proposedCents
      return (
        <>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Ajustar ${c}`}
            onClick={() => setEditing(l)}
          >
            Ajustar
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Remover ${c}`}
            disabled={busy}
            onClick={() => clear(c)}
          >
            Remover
          </Button>
          {proposed !== null && current !== null && (
            <span className="flex items-center gap-2 text-sm">
              <span>{`Sugestão: ${formatBRL(proposed)}`}</span>
              <Button
                size="sm"
                aria-label={`Usar ${c}`}
                disabled={busy}
                onClick={() => set(c, proposed)}
              >
                Usar
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Manter ${c}`}
                disabled={busy}
                onClick={() => set(c, current)}
              >
                Manter
              </Button>
            </span>
          )}
        </>
      )
    }
    return (
      <>
        {l.status === 'DECLINED' ? (
          <span className="text-muted-foreground text-sm">Recusado</span>
        ) : (
          <span className="text-muted-foreground text-sm">Sem histórico</span>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`Definir ${c}`}
          onClick={() => setEditing(l)}
        >
          Definir
        </Button>
      </>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Limites</h1>

      {isPending && <Skeleton className="h-32" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar os limites.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead column="category" sort={sort} onSort={onSort}>
                Categoria
              </SortableHead>
              <SortableHead column="spent" sort={sort} onSort={onSort}>
                Gasto no mês
              </SortableHead>
              <SortableHead column="limit" sort={sort} onSort={onSort}>
                Limite
              </SortableHead>
              <SortableHead column="usage" sort={sort} onSort={onSort}>
                Uso
              </SortableHead>
              <SortableHead column="proposal" sort={sort} onSort={onSort}>
                Proposta
              </SortableHead>
              <th className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => {
              const ratio = usage(l)
              return (
                <TableRow key={l.category}>
                  <TableCell className="font-medium">{l.category}</TableCell>
                  <TableCell>{formatBRL(l.spentCents)}</TableCell>
                  <TableCell>
                    {l.status === 'ACTIVE' && l.limitCents !== null
                      ? formatBRL(l.limitCents)
                      : ''}
                  </TableCell>
                  <TableCell>
                    {ratio !== null && (
                      <div className="flex items-center gap-2">
                        <div
                          className="bg-muted h-2 w-24 overflow-hidden rounded-full"
                          role="progressbar"
                          aria-label={`Uso de ${l.category}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.min(100, Math.round(ratio * 100))}
                        >
                          <div
                            className={`h-full ${ratio > 1 ? 'bg-destructive' : 'bg-primary'}`}
                            style={{ width: `${Math.min(100, ratio * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm tabular-nums">{`${Math.round(ratio * 100)}%`}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {l.proposedCents !== null ? formatBRL(l.proposedCents) : ''}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {actions(l)}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <LimitDialog
        key={editing?.category}
        limit={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  )
}
