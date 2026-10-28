import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { SortableHead } from '@/components/sortable-head'
import { TransactionDialog } from '@/components/transaction-dialog'
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
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type AnalysisTransaction,
  listAnalysisTransactions,
} from '@/http/analysis'
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
  const [sort, setSort] = useState<Sort<Column> | null>(null)
  const [selected, setSelected] = useState<AnalysisTransaction | null>(null)

  const list = useQuery({
    queryKey: ['analysis-transactions', category, month ?? null],
    queryFn: () =>
      listAnalysisTransactions({ category: category as string, month }),
    enabled: category !== null,
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
            return t.amountCents
        }
      })
    : transactions
  const onSort = (column: Column) =>
    setSort((current) => toggleSort(current, column))

  return (
    <>
      <Sheet
        open={category !== null}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:w-1/2 sm:max-w-none sm:min-w-[40rem]">
          <SheetHeader>
            <SheetTitle>
              {category === 'none' ? 'Sem categoria' : category}
            </SheetTitle>
            <SheetDescription>
              Clique numa transação para editar a descrição, a categoria (a
              escolha vira regra) ou a marca.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {list.isPending && <Skeleton className="h-64" />}
            {list.isError && (
              <p className="text-sm">
                Não foi possível carregar as transações.
              </p>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(t)}
                    >
                      <TableCell className="tabular-nums">
                        {formatDate(t.date)}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left underline-offset-4 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(t)
                          }}
                        >
                          {t.description}
                        </button>
                      </TableCell>
                      <TableCell>{t.accountName}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatBRL(t.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <TransactionDialog
        transaction={selected}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
