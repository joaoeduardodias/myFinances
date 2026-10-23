export type SortOrder = 'asc' | 'desc'

export interface Sort<K extends string> {
  column: K
  order: SortOrder
}

/** Mesma coluna inverte a ordem; outra coluna começa crescente. */
export function toggleSort<K extends string>(
  current: Sort<K> | null,
  column: K,
): Sort<K> {
  if (current?.column !== column) return { column, order: 'asc' }
  return { column, order: current.order === 'asc' ? 'desc' : 'asc' }
}

/** Ordena no cliente, para tabelas sem paginação no servidor. */
export function sortRows<T, K extends string>(
  rows: T[],
  sort: Sort<K>,
  value: (row: T, column: K) => string | number | null,
): T[] {
  const sign = sort.order === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = value(a, sort.column)
    const vb = value(b, sort.column)
    // Vazio fica por último nos dois sentidos.
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * sign
    }
    return String(va).localeCompare(String(vb), 'pt-BR') * sign
  })
}
