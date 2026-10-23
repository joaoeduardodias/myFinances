import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { PayslipLinesEditor } from '@/components/payslip-lines-editor'
import { PayslipStatusBadge } from '@/components/payslip-status-badge'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  deletePayslip,
  getPayslip,
  getPayslipFileUrl,
  PAYSLIP_TYPE_LABELS,
  type PayslipLine,
} from '@/http/payslips'
import { formatBRL, formatDate } from '@/lib/format'
import { formatCompetence } from '@/lib/payslip'
import { type Sort, sortRows, toggleSort } from '@/lib/sort'

type LineSortColumn = 'description' | 'reference' | 'amount'

function lineValue(line: PayslipLine, column: LineSortColumn) {
  if (column === 'amount') return line.amountCents
  return line[column]
}

function LinesTable({ title, lines }: { title: string; lines: PayslipLine[] }) {
  // Sem ordenação escolhida, mantém a ordem do holerite.
  const [sort, setSort] = useState<Sort<LineSortColumn> | null>(null)
  const rows = sort ? sortRows(lines, sort, lineValue) : lines
  const onSort = (column: LineSortColumn) =>
    setSort((current) => toggleSort(current, column))

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{title}</h2>
      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nenhum lançamento.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead column="description" sort={sort} onSort={onSort}>
                Descrição
              </SortableHead>
              <SortableHead column="reference" sort={sort} onSort={onSort}>
                Referência
              </SortableHead>
              <SortableHead
                column="amount"
                sort={sort}
                onSort={onSort}
                className="text-right"
              >
                Valor
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.description}</TableCell>
                <TableCell className="text-muted-foreground">
                  {l.reference ?? '—'}
                </TableCell>
                <TableCell className="text-right">
                  {formatBRL(l.amountCents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

export function PayslipDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['payslip', id],
    queryFn: () => getPayslip(id),
  })

  // A aba nasce no clique, ainda dentro do gesto do usuário: aberta depois
  // da resposta, o bloqueador de pop-up a barraria. `tab` é a variável da
  // mutação; sem aba (bloqueada mesmo assim), o PDF abre nesta.
  const download = useMutation<string, unknown, Window | null>({
    mutationFn: () => getPayslipFileUrl(id),
    onSuccess: (url, tab) => {
      if (tab) tab.location.href = url
      else window.location.assign(url)
    },
    onError: async (error, tab) => {
      tab?.close()
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível baixar o PDF. Tente novamente.',
        ),
      )
    },
  })

  function openPdf() {
    const tab = window.open('', '_blank')
    // O mesmo que `noopener`: a aba do PDF não alcança esta.
    if (tab) tab.opener = null
    download.mutate(tab)
  }

  const remove = useMutation({
    mutationFn: () => deletePayslip(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payslips'] }),
        queryClient.removeQueries({ queryKey: ['payslip', id] }),
      ])
      navigate('/holerites')
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível excluir. Tente novamente.',
        ),
      ),
  })

  const payslip = data?.payslip
  const editable = payslip?.status !== 'RECOGNIZED'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <Link to="/holerites" className="text-muted-foreground text-sm underline">
        Voltar para holerites
      </Link>

      {isPending && <Skeleton className="h-40" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar o holerite.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && payslip && (
        <>
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold">
                {`Holerite ${formatCompetence(payslip.competence)}`}
              </h1>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={download.isPending}
                  onClick={openPdf}
                >
                  <Download aria-hidden />
                  Baixar PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 aria-hidden />
                  Excluir
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{PAYSLIP_TYPE_LABELS[payslip.type]}</span>
              <PayslipStatusBadge status={payslip.status} />
              {payslip.status !== 'UNRECOGNIZED' &&
                (data.reconciliation.matched &&
                data.reconciliation.transaction ? (
                  <Badge
                    variant="outline"
                    className="border-income/50 text-income"
                  >
                    {`Líquido conferido com o depósito de ${formatDate(data.reconciliation.transaction.date)}`}
                  </Badge>
                ) : (
                  <Badge variant="outline">Depósito não encontrado</Badge>
                ))}
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Bruto</dt>
                <dd className="font-medium">
                  {payslip.grossCents === null
                    ? '—'
                    : formatBRL(payslip.grossCents)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Líquido</dt>
                <dd className="font-medium">
                  {payslip.netCents === null
                    ? '—'
                    : formatBRL(payslip.netCents)}
                </dd>
              </div>
            </dl>
          </header>

          {editable ? (
            <section className="flex flex-col gap-4">
              {payslip.status === 'UNRECOGNIZED' && (
                <p
                  role="status"
                  className="bg-muted text-muted-foreground rounded-lg border p-4 text-sm"
                >
                  Ainda não sabemos ler este layout — lance os valores abaixo
                </p>
              )}
              <PayslipLinesEditor
                key={`${payslip.id}-${payslip.status}-${data.lines.length}`}
                payslipId={payslip.id}
                grossCents={payslip.grossCents}
                netCents={payslip.netCents}
                lines={data.lines}
              />
            </section>
          ) : (
            <>
              <LinesTable
                title="Proventos"
                lines={data.lines.filter((l) => l.kind === 'EARNING')}
              />
              <LinesTable
                title="Descontos"
                lines={data.lines.filter((l) => l.kind === 'DEDUCTION')}
              />
            </>
          )}
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este holerite?</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo e os valores lançados serão removidos. Esta ação não
              pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
