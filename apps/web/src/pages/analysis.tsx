import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { AnalysisChart, GROUP_META } from '@/components/analysis-chart'
import { SortableHead } from '@/components/sortable-head'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type Analysis,
  type AnalysisCategory,
  type AnalysisExpense,
  getAnalysis,
} from '@/http/analysis'
import { formatBRL, formatDate } from '@/lib/format'
import { type Sort, sortRows, toggleSort } from '@/lib/sort'

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/

const monthName = new Intl.DateTimeFormat('pt-BR', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** 'YYYY-MM' ou 'YYYY-MM-DD' em "nov/2025". */
function shortMonth(iso: string) {
  const [year, month] = iso.split('-').map(Number)
  return monthName
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace('.', '')
    .replace(' de ', '/')
    .replace(' ', '/')
}

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})

function share(part: number, whole: number) {
  return whole > 0 ? percent.format(part / whole) : '—'
}

function Kpi({
  label,
  valueCents,
  tone = '',
  hint,
}: {
  label: string
  valueCents: number
  tone?: string
  hint?: string
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="text-xs font-semibold tracking-wider uppercase">
          {label}
        </CardDescription>
        <CardTitle className={`text-xl font-semibold tabular-nums ${tone}`}>
          {formatBRL(valueCents)}
        </CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="text-muted-foreground px-4 text-xs tabular-nums">
          {hint}
        </CardContent>
      )}
    </Card>
  )
}

function Indicators({ totals }: { totals: Analysis['totals'] }) {
  const spent =
    totals.essentialCents +
    totals.avoidableCents +
    totals.debtCents +
    totals.unclassifiedCents
  const result = totals.incomeCents - spent
  return (
    <section
      aria-label="Indicadores"
      className="grid gap-4 sm:grid-cols-3 2xl:grid-cols-6"
    >
      <Kpi label="Entrou" valueCents={totals.incomeCents} tone="text-income" />
      <Kpi label="Saiu" valueCents={spent} />
      <Kpi
        label={result < 0 ? 'Faltou' : 'Sobrou'}
        valueCents={Math.abs(result)}
        tone={result < 0 ? 'text-destructive' : 'text-income'}
      />
      <Kpi
        label="Essencial"
        valueCents={totals.essentialCents}
        hint={`${share(totals.essentialCents, spent)} do que saiu`}
      />
      <Kpi
        label="Evitável"
        valueCents={totals.avoidableCents}
        hint={`${share(totals.avoidableCents, spent)} do que saiu`}
      />
      <Kpi
        label="Dívida"
        valueCents={totals.debtCents}
        hint={`${share(totals.debtCents, spent)} do que saiu`}
      />
    </section>
  )
}

type CategoryColumn =
  | 'category'
  | 'group'
  | 'total'
  | 'share'
  | 'average'
  | 'count'

function CategoriesTable({
  categories,
  spentCents,
  onOpen,
}: {
  categories: AnalysisCategory[]
  spentCents: number
  onOpen: (category: string | 'none') => void
}) {
  const [sort, setSort] = useState<Sort<CategoryColumn> | null>({
    column: 'total',
    order: 'desc',
  })
  const rows = sort
    ? sortRows(categories, sort, (c, column) => {
        switch (column) {
          case 'category':
            return c.category ?? 'Sem categoria'
          case 'group':
            return GROUP_META[c.group].label
          case 'average':
            return c.averageCents
          case 'count':
            return c.count
          default:
            return c.totalCents
        }
      })
    : categories
  const onSort = (column: CategoryColumn) =>
    setSort((current) => toggleSort(current, column))

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Para onde foi</CardTitle>
      </CardHeader>
      <CardContent>
        <Table aria-label="Para onde foi">
          <TableHeader>
            <TableRow>
              <SortableHead column="category" sort={sort} onSort={onSort}>
                Categoria
              </SortableHead>
              <SortableHead column="group" sort={sort} onSort={onSort}>
                Grupo
              </SortableHead>
              <SortableHead column="total" sort={sort} onSort={onSort}>
                Total
              </SortableHead>
              <SortableHead column="share" sort={sort} onSort={onSort}>
                % do que saiu
              </SortableHead>
              <SortableHead column="average" sort={sort} onSort={onSort}>
                Média mensal
              </SortableHead>
              <SortableHead column="count" sort={sort} onSort={onSort}>
                Quantidade
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const key = c.category ?? 'none'
              return (
                <TableRow
                  key={key}
                  className="cursor-pointer"
                  onClick={() => onOpen(key)}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium underline-offset-4 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(key)
                      }}
                    >
                      {c.category ?? 'Sem categoria'}
                    </button>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: GROUP_META[c.group].color }}
                        aria-hidden
                      />
                      {GROUP_META[c.group].label}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBRL(c.totalCents)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {share(c.totalCents, spentCents)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBRL(c.averageCents)}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.count}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

type ExpenseColumn = 'date' | 'description' | 'account' | 'amount'

function ExpensesTable({
  title,
  expenses,
}: {
  title: string
  expenses: AnalysisExpense[]
}) {
  const [sort, setSort] = useState<Sort<ExpenseColumn> | null>(null)
  const rows = sort
    ? sortRows(expenses, sort, (e, column) => {
        switch (column) {
          case 'date':
            return e.date
          case 'description':
            return e.description
          case 'account':
            return e.accountName
          default:
            return Math.abs(e.amountCents)
        }
      })
    : expenses
  const onSort = (column: ExpenseColumn) =>
    setSort((current) => toggleSort(current, column))

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table aria-label={title}>
          <TableHeader>
            <TableRow>
              <SortableHead column="date" sort={sort} onSort={onSort}>
                Data
              </SortableHead>
              <SortableHead column="description" sort={sort} onSort={onSort}>
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
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums">
                  {formatDate(e.date)}
                </TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell>{e.accountName}</TableCell>
                <TableCell className="tabular-nums">
                  {formatBRL(Math.abs(e.amountCents))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AnalysisSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-24" />
      <Skeleton className="h-96" />
      <Skeleton className="h-64" />
    </div>
  )
}

export function AnalysisPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('mes')
  const month = raw && MONTH_PARAM.test(raw) ? raw : undefined
  // Task 7 abre o detalhe da categoria escolhida ('none' = sem categoria).
  const [openedCategory, setOpenedCategory] = useState<string | null>(null)
  const openCategory = (category: string | 'none') =>
    setOpenedCategory(category)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['analysis', month ?? null],
    queryFn: () => getAnalysis(month),
  })

  const spent = data
    ? data.totals.essentialCents +
      data.totals.avoidableCents +
      data.totals.debtCents +
      data.totals.unclassifiedCents
    : 0
  const period = data
    ? month
      ? shortMonth(month)
      : `${shortMonth(data.from)} – ${shortMonth(data.to)}`
    : null

  return (
    <div
      className="flex w-full flex-col gap-4 p-4 sm:p-6 lg:p-8 xl:gap-6"
      data-open-category={openedCategory ?? undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Análise</h1>
          {period && <p className="text-muted-foreground text-sm">{period}</p>}
        </div>
        {month && (
          <Button variant="outline" size="sm" onClick={() => setParams({})}>
            Ver 12 meses
          </Button>
        )}
      </div>

      {isPending && <AnalysisSkeleton />}
      {isError && (
        <div className="flex flex-col items-start gap-3 rounded-lg border p-4">
          <p className="text-sm">Não foi possível carregar a análise.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {data && (
        <>
          <Indicators totals={data.totals} />
          {data.uncategorized.count > 0 && (
            <button
              type="button"
              onClick={() => openCategory('none')}
              className="bg-muted text-muted-foreground hover:bg-accent rounded-lg border p-4 text-left text-sm"
            >
              {`${data.uncategorized.count} ${
                data.uncategorized.count === 1
                  ? 'transação sem categoria somando'
                  : 'transações sem categoria somando'
              } ${formatBRL(data.uncategorized.totalCents)}`}
            </button>
          )}
          <AnalysisChart
            months={data.months}
            onSelectMonth={(m) => setParams({ mes: m })}
          />
          <CategoriesTable
            categories={data.categories}
            spentCents={spent}
            onOpen={openCategory}
          />
          <div className="grid gap-4 xl:grid-cols-2 xl:gap-6">
            <ExpensesTable title="Maiores gastos" expenses={data.topExpenses} />
            <ExpensesTable
              title="Dava pra evitar"
              expenses={data.topAvoidable}
            />
          </div>
        </>
      )}
    </div>
  )
}
