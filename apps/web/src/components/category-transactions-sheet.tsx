import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/native-select'
import { SortableHead } from '@/components/sortable-head'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  listAnalysisTransactions,
  type Necessity,
  setTransactionNecessity,
} from '@/http/analysis'
import { listCategories, setTransactionCategory } from '@/http/transactions'
import { formatBRL, formatDate } from '@/lib/format'
import { type Sort, sortRows, toggleSort } from '@/lib/sort'

type Column = 'date' | 'description' | 'account' | 'amount'

interface Props {
  /** `null` fecha o detalhe; 'none' = sem categoria. */
  category: string | null
  month?: string
  onClose: () => void
}

export function CategoryTransactionsSheet({ category, month, onClose }: Props) {
  const queryClient = useQueryClient()
  const [sort, setSort] = useState<Sort<Column> | null>(null)

  const list = useQuery({
    queryKey: ['analysis-transactions', category, month ?? null],
    queryFn: () =>
      listAnalysisTransactions({ category: category as string, month }),
    enabled: category !== null,
  })
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    enabled: category !== null,
  })

  const invalidate = () =>
    Promise.all(
      ['analysis', 'analysis-transactions'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    )

  const changeCategory = useMutation({
    mutationFn: (v: { id: string; category: string }) =>
      setTransactionCategory(v.id, v.category),
    onSuccess: invalidate,
    onError: () =>
      toast.error('Não foi possível alterar a categoria. Tente novamente.'),
  })
  const changeNecessity = useMutation({
    mutationFn: (v: { id: string; necessity: Necessity | null }) =>
      setTransactionNecessity(v.id, v.necessity),
    onSuccess: invalidate,
    onError: () =>
      toast.error('Não foi possível alterar a marca. Tente novamente.'),
  })

  const transactions = list.data ?? []
  const rows = sort
    ? sortRows(transactions, sort, (t, column) => {
        switch (column) {
          case 'date':
            return t.date
          case 'description':
            return t.description
          case 'account':
            return t.accountName
          default:
            return Math.abs(t.amountCents)
        }
      })
    : transactions
  const onSort = (column: Column) =>
    setSort((current) => toggleSort(current, column))
  const categoryNames = categories.data ?? []

  return (
    <Sheet
      open={category !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>
            {category === 'none' ? 'Sem categoria' : category}
          </SheetTitle>
          <SheetDescription>
            Troque a categoria (a escolha vira regra) ou marque a transação como
            essencial ou evitável.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {list.isPending && <Skeleton className="h-64" />}
          {list.isError && (
            <p className="text-sm">Não foi possível carregar as transações.</p>
          )}
          {list.data && (
            <Table aria-label="Transações da categoria">
              <TableHeader>
                <TableRow>
                  <SortableHead column="date" sort={sort} onSort={onSort}>
                    Data
                  </SortableHead>
                  <SortableHead
                    column="description"
                    sort={sort}
                    onSort={onSort}
                  >
                    Descrição
                  </SortableHead>
                  <SortableHead column="account" sort={sort} onSort={onSort}>
                    Conta
                  </SortableHead>
                  <SortableHead column="amount" sort={sort} onSort={onSort}>
                    Valor
                  </SortableHead>
                  <TableHead>Classificação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="tabular-nums">
                      {formatDate(t.date)}
                    </TableCell>
                    <TableCell>{t.description}</TableCell>
                    <TableCell>{t.accountName}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatBRL(t.amountCents)}
                    </TableCell>
                    <TableCell className="min-w-56">
                      <div className="flex flex-col gap-2">
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
                        {t.amountCents < 0 && (
                          <NativeSelect
                            aria-label={`Marca de ${t.description}`}
                            value={t.necessity ?? ''}
                            onChange={(e) =>
                              changeNecessity.mutate({
                                id: t.id,
                                necessity: (e.target.value ||
                                  null) as Necessity | null,
                              })
                            }
                          >
                            <option value="">Padrão da categoria</option>
                            <option value="ESSENTIAL">Essencial</option>
                            <option value="AVOIDABLE">Evitável</option>
                          </NativeSelect>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
