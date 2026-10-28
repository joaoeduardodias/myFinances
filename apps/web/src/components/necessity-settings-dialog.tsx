import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/native-select'
import { SortableHead } from '@/components/sortable-head'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
  listCategoryNecessities,
  type Necessity,
  setCategoryNecessity,
} from '@/http/analysis'
import { type Sort, sortRows, toggleSort } from '@/lib/sort'

type Column = 'category'

export function NecessitySettingsDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<Sort<Column> | null>(null)

  const list = useQuery({
    queryKey: ['category-necessities'],
    queryFn: listCategoryNecessities,
    enabled: open,
  })
  const save = useMutation({
    mutationFn: (v: { category: string; necessity: Necessity }) =>
      setCategoryNecessity(v.category, v.necessity),
    onSuccess: () =>
      Promise.all(
        ['category-necessities', 'analysis', 'analysis-transactions'].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    onError: () =>
      toast.error('Não foi possível salvar o padrão. Tente novamente.'),
  })

  const items = list.data ?? []
  const rows = sort ? sortRows(items, sort, (c) => c.category) : items

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Essencial ou evitável
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Essencial ou evitável</DialogTitle>
          <DialogDescription>
            Padrão de cada categoria. Cada transação pode ter a própria marca.
          </DialogDescription>
        </DialogHeader>
        {list.isPending && <Skeleton className="h-48" />}
        {list.isError && (
          <p className="text-sm">Não foi possível carregar os padrões.</p>
        )}
        {list.data && (
          <Table aria-label="Padrões por categoria">
            <TableHeader>
              <TableRow>
                <SortableHead
                  column="category"
                  sort={sort}
                  onSort={(c) => setSort((cur) => toggleSort(cur, c))}
                >
                  Categoria
                </SortableHead>
                <TableHead>Padrão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.category}>
                  <TableCell>
                    {c.category}
                    {c.isDefault && (
                      <span className="text-muted-foreground"> (padrão)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`Padrão de ${c.category}`}
                      value={c.necessity}
                      onChange={(e) =>
                        save.mutate({
                          category: c.category,
                          necessity: e.target.value as Necessity,
                        })
                      }
                    >
                      <option value="ESSENTIAL">Essencial</option>
                      <option value="AVOIDABLE">Evitável</option>
                    </NativeSelect>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}
