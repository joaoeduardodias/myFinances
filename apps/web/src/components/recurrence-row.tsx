import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, type LucideIcon, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  linkedMessage,
  RecurrenceLinkDialog,
} from '@/components/recurrence-link-dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  deleteRecurrence,
  dismissLinkSuggestion,
  dismissRecurrence,
  getRecurrence,
  linkTransactions,
  type MonthStatus,
  type Recurrence,
  type RecurrenceDirection,
  type RecurrenceTx,
  unlinkTransaction,
  updateRecurrence,
} from '@/http/recurrences'
import { formatBRL, formatDate } from '@/lib/format'

const MONTH_NAMES = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

/** 'YYYY-MM' em 'jun/27'. */
export function shortMonth(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]}/${month.slice(2, 4)}`
}

/** De onde sai: a conta, qualquer uma, ou o salário (desconto em folha). */
export function sourceText(r: Recurrence) {
  if (r.payrollDeduction) {
    return r.payrollSource
      ? `Descontado em folha (${r.payrollSource.description})`
      : 'Descontado em folha'
  }
  return r.account?.name ?? 'Qualquer conta'
}

export function ruleText(r: Recurrence) {
  return r.dayRule === 'DAY_OF_MONTH'
    ? `Todo dia ${r.dayValue}`
    : `${r.dayValue}º dia útil`
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function statusText(status: MonthStatus, direction: RecurrenceDirection) {
  if (status.state === 'PAID') {
    return `${direction === 'IN' ? 'recebido' : 'pago'} ${formatDate(status.date).slice(0, 5)}`
  }
  if (status.state === 'LATE') {
    // "Atrasado" é de conta a pagar; entrada que não veio é aviso, não dívida.
    return direction === 'IN'
      ? `não recebido há ${plural(status.days, 'dia', 'dias')}`
      : `atrasado ${plural(status.days, 'dia', 'dias')}`
  }
  const verb = direction === 'IN' ? 'previsto' : 'vence'
  if (status.days === 0) return `${verb} hoje`
  if (status.days === 1) return `${verb} amanhã`
  return `${verb} em ${status.days} dias`
}

const STATUS_CLASS: Record<MonthStatus['state'], string> = {
  PAID: 'bg-income/15 text-income',
  DUE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  LATE: 'bg-destructive/15 text-destructive',
}

export function StatusChip({ recurrence }: { recurrence: Recurrence }) {
  const status = recurrence.monthStatus
  if (!status) return null
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        status.state === 'LATE' && recurrence.direction === 'IN'
          ? STATUS_CLASS.DUE
          : STATUS_CLASS[status.state]
      }`}
    >
      {statusText(status, recurrence.direction)}
    </span>
  )
}

export function Amount({ recurrence }: { recurrence: Recurrence }) {
  const isIn = recurrence.direction === 'IN'
  return (
    <span
      className={`min-w-24 shrink-0 text-right text-sm font-semibold whitespace-nowrap tabular-nums ${isIn ? 'text-income' : ''}`}
    >
      {`${isIn ? '+' : '−'}${formatBRL(recurrence.expectedAmountCents)}`}
    </span>
  )
}

function LoanProgress({ recurrence }: { recurrence: Recurrence }) {
  const loan = recurrence.loan
  if (!loan) return null
  if (loan.remaining === null || loan.remainingCents === null) {
    return (
      <span className="text-muted-foreground block text-xs">
        sem total informado
      </span>
    )
  }
  const paid = recurrence.linkedCount
  const percent = Math.round((paid / (paid + loan.remaining || 1)) * 100)
  const end = loan.endMonth ? ` · até ${shortMonth(loan.endMonth)}` : ''
  return (
    <span className="mt-1 flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {`${loan.remaining === 1 ? 'falta 1 parcela' : `faltam ${loan.remaining} parcelas`} · ${formatBRL(loan.remainingCents)}${end}`}
      </span>
      <span className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
        <span
          className="bg-income block h-full"
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  )
}

function MonthBars({
  months,
}: {
  months: { month: string; amountCents: number }[]
}) {
  const max = Math.max(1, ...months.map((m) => m.amountCents))
  const label = `Últimos 6 meses: ${months
    .map((m) => `${shortMonth(m.month)} ${formatBRL(m.amountCents)}`)
    .join(', ')}`
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">Últimos 6 meses</span>
      <div role="img" aria-label={label} className="flex h-10 items-end gap-1">
        {months.map((m, i) => (
          <span
            key={m.month}
            title={`${shortMonth(m.month)}: ${formatBRL(m.amountCents)}`}
            className={`w-5 rounded-t-sm ${i === months.length - 1 ? 'bg-amber-500/70' : 'bg-muted-foreground/40'}`}
            style={{ height: `${Math.max(6, (m.amountCents / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function txLabel(tx: RecurrenceTx) {
  return `${formatDate(tx.date)} · ${tx.description}`
}

function useRecurrenceMutation<T, R = unknown>(
  fn: (arg: T) => Promise<R>,
  {
    success,
    failure,
  }: { success?: string | ((result: R) => string); failure: string },
) {
  const queryClient = useQueryClient()
  return useMutation({
    // Arrow: o TanStack passa um 2º argumento (contexto) que não é da API.
    mutationFn: (arg: T) => fn(arg),
    onSuccess: async (result) => {
      await Promise.all(
        ['recurrences', 'recurrence', 'dashboard'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      if (success) {
        toast.success(typeof success === 'string' ? success : success(result))
      }
    },
    onError: async (error) =>
      toast.error(await getApiErrorMessage(error, failure)),
  })
}

function DetailPanel({
  recurrence,
  onEdit,
}: {
  recurrence: Recurrence
  onEdit: (r: Recurrence) => void
}) {
  const [linkDialog, setLinkDialog] = useState<'pick' | 'linked' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isExternal = recurrence.kind === 'EXTERNAL'
  const detail = useQuery({
    queryKey: ['recurrence', recurrence.id],
    queryFn: () => getRecurrence(recurrence.id),
  })

  const unlink = useRecurrenceMutation(
    (txId: string) => unlinkTransaction(recurrence.id, txId),
    { failure: 'Não foi possível desvincular. Tente novamente.' },
  )
  const link = useRecurrenceMutation(
    (txId: string) => linkTransactions(recurrence.id, [txId]),
    {
      // As parecidas vêm junto: a mensagem diz quantas.
      success: linkedMessage,
      failure: 'Não foi possível vincular. Tente novamente.',
    },
  )
  const notThis = useRecurrenceMutation(
    (txId: string) => dismissLinkSuggestion(recurrence.id, txId),
    { failure: 'Não foi possível registrar. Tente novamente.' },
  )
  const setStatus = useRecurrenceMutation(
    (status: 'CONFIRMED' | 'PAID_OFF') =>
      updateRecurrence(recurrence.id, { status }),
    {
      success: 'Recorrente atualizado.',
      failure: 'Não foi possível atualizar. Tente novamente.',
    },
  )
  const dismiss = useRecurrenceMutation(
    () => dismissRecurrence(recurrence.id),
    {
      success: 'Recorrente descartado.',
      failure: 'Não foi possível descartar. Tente novamente.',
    },
  )
  const remove = useRecurrenceMutation(() => deleteRecurrence(recurrence.id), {
    success: 'Recorrente apagado.',
    failure: 'Não foi possível apagar. Tente novamente.',
  })

  const busy =
    unlink.isPending ||
    link.isPending ||
    notThis.isPending ||
    setStatus.isPending

  return (
    <div className="bg-muted/30 flex flex-col gap-4 border-t border-dashed px-4 py-4 sm:pl-14">
      {detail.isPending && <Skeleton className="h-24" aria-busy="true" />}
      {detail.isError && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm">
          Não foi possível carregar o detalhe.
          <Button variant="outline" size="sm" onClick={() => detail.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {isExternal && (
        <p className="text-muted-foreground text-sm">
          Lançado à mão: não passa pela Pluggy, conta como feito na data e fica
          fora do "Quanto posso gastar".
        </p>
      )}

      {detail.data && !isExternal && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
            <MonthBars months={detail.data.months} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {`Transações vinculadas (${detail.data.linked.total})`}
              </span>
              {detail.data.linked.total === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nenhuma ainda. Escolha as transações que são deste recorrente.
                </p>
              ) : (
                <ul
                  aria-label="Transações vinculadas"
                  className="flex flex-col gap-0.5"
                >
                  {detail.data.linked.items.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {`${txLabel(tx)} · `}
                        <span className="text-muted-foreground">
                          {tx.account.name}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatBRL(tx.amountCents)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={`Desvincular ${tx.description} de ${formatDate(tx.date)}`}
                        disabled={busy}
                        onClick={() => unlink.mutate(tx.id)}
                      >
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {detail.data.linked.total > detail.data.linked.items.length && (
                <Button
                  variant="link"
                  size="sm"
                  className="self-start px-0"
                  onClick={() => setLinkDialog('linked')}
                >
                  {`Ver todas (${detail.data.linked.total})`}
                </Button>
              )}
            </div>
          </div>

          {detail.data.suggestions.map((tx) => (
            <div
              key={tx.id}
              className="flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center"
            >
              <span className="min-w-0 flex-1">
                {'Parece deste recorrente: '}
                <strong className="font-medium">{`${txLabel(tx)} · ${formatBRL(tx.amountCents)}`}</strong>
                <span className="text-muted-foreground">{` (${tx.account.name})`}</span>
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => link.mutate(tx.id)}
                >
                  Vincular
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => notThis.mutate(tx.id)}
                >
                  Não é
                </Button>
              </div>
            </div>
          ))}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!isExternal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinkDialog('pick')}
          >
            Escolher transações
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`Editar ${recurrence.description}`}
          onClick={() => onEdit(recurrence)}
        >
          Editar
        </Button>
        {recurrence.kind === 'LOAN' && !recurrence.paidOff && (
          <Button
            variant="outline"
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate('PAID_OFF')}
          >
            Marcar como quitado
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate(undefined)}
        >
          Descartar
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-destructive border-destructive/40 sm:ml-auto"
          onClick={() => setConfirmDelete(true)}
        >
          Apagar
        </Button>
      </div>

      {linkDialog && (
        <RecurrenceLinkDialog
          recurrence={recurrence}
          onlyLinked={linkDialog === 'linked'}
          open
          onOpenChange={(open) => !open && setLinkDialog(null)}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar recorrente?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${recurrence.description}" será apagado. As transações continuam, só perdem o vínculo. Se a Pluggy continuar trazendo, ele pode voltar como sugestão; para não voltar, use Descartar.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined)}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Linha do recorrente; clicar abre o histórico, os vínculos e as ações. */
export function RecurrenceRow({
  recurrence,
  icon: Icon,
  onEdit,
}: {
  recurrence: Recurrence
  icon: LucideIcon
  onEdit: (r: Recurrence) => void
}) {
  const [open, setOpen] = useState(false)
  const panelId = `recurrence-panel-${recurrence.id}`
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 focus-visible:ring-ring/50 flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:ring-[3px]"
      >
        <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md">
          <Icon className="text-muted-foreground size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {recurrence.description}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {`${ruleText(recurrence)} · ${sourceText(recurrence)}`}
          </span>
          <LoanProgress recurrence={recurrence} />
        </span>
        <StatusChip recurrence={recurrence} />
        <Amount recurrence={recurrence} />
        {open ? (
          <ChevronDown
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden
          />
        )}
      </button>
      {open && (
        <div id={panelId}>
          <DetailPanel recurrence={recurrence} onEdit={onEdit} />
        </div>
      )}
    </li>
  )
}
