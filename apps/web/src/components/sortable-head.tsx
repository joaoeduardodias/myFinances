import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { TableHead } from '@/components/ui/table'
import type { Sort } from '@/lib/sort'

interface SortableHeadProps<K extends string> {
  column: K
  /** `null`: nenhuma coluna escolhida ainda. */
  sort: Sort<K> | null
  onSort: (column: K) => void
  className?: string
  children: string
}

export function SortableHead<K extends string>({
  column,
  sort,
  onSort,
  className,
  children,
}: SortableHeadProps<K>) {
  const active = sort?.column === column
  const Icon = !active
    ? ArrowUpDown
    : sort.order === 'asc'
      ? ArrowUp
      : ArrowDown
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'
      }
    >
      <button
        type="button"
        className="inline-flex items-center gap-1"
        onClick={() => onSort(column)}
      >
        {children}
        <Icon aria-hidden className="size-3.5" />
      </button>
    </TableHead>
  )
}
