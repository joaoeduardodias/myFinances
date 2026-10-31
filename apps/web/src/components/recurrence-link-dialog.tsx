import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage } from '@/http/get-api-error-message'
import {
  type LinkCandidate,
  type LinkResult,
  linkTransactions,
  listLinkCandidates,
  type Recurrence,
  unlinkTransaction,
} from '@/http/recurrences'
import { formatBRL, formatDate } from '@/lib/format'

const SEARCH_DEBOUNCE_MS = 300

/** Quantas entraram, contando as parecidas que vieram junto. */
export function linkedMessage({ linked, similar }: LinkResult): string {
  const total = linked + similar
  const head =
    total === 1 ? '1 transação vinculada' : `${total} transações vinculadas`
  if (similar === 0) return `${head}.`
  return `${head} (${similar === 1 ? '1 parecida' : `${similar} parecidas`}).`
}

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/**
 * Marca ou desmarca transações do recorrente. O que muda é guardado à parte
 * (`toggled`) para enviar só os vínculos adicionados e os removidos.
 */
function LinkDialogBody({
  recurrence,
  onlyLinked,
  onDone,
}: {
  recurrence: Recurrence
  onlyLinked: boolean
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [toggled, setToggled] = useState<Map<string, LinkCandidate>>(new Map())
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS)

  const params = onlyLinked
    ? { linked: true, page }
    : { ...(debouncedSearch && { search: debouncedSearch }), page }
  const candidates = useQuery({
    queryKey: ['recurrence-candidates', recurrence.id, params],
    queryFn: () => listLinkCandidates(recurrence.id, params),
    placeholderData: (previous) => previous,
  })

  const isLinkedNow = (tx: LinkCandidate) =>
    tx.linkedHere !== toggled.has(tx.id)

  function toggle(tx: LinkCandidate) {
    setToggled((current) => {
      const next = new Map(current)
      if (next.has(tx.id)) next.delete(tx.id)
      else next.set(tx.id, tx)
      return next
    })
  }

  const save = useMutation({
    mutationFn: async () => {
      const changes = [...toggled.values()]
      const added = changes.filter((tx) => !tx.linkedHere).map((tx) => tx.id)
      const removed = changes.filter((tx) => tx.linkedHere).map((tx) => tx.id)
      const result =
        added.length > 0 ? await linkTransactions(recurrence.id, added) : null
      await Promise.all(
        removed.map((id) => unlinkTransaction(recurrence.id, id)),
      )
      return result
    },
    onSuccess: async (result) => {
      await Promise.all(
        ['recurrences', 'recurrence', 'recurrence-candidates', 'dashboard'].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      toast.success(result ? linkedMessage(result) : 'Vínculos salvos.')
      onDone()
    },
    onError: async (error) =>
      toast.error(
        await getApiErrorMessage(
          error,
          'Não foi possível salvar os vínculos. Tente novamente.',
        ),
      ),
  })

  const data = candidates.data
  const lastPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    // `min-w-0`: item de grid não encolhe abaixo do conteúdo sem isto, e a janela rolava para o lado.
    <div className="flex min-w-0 flex-col gap-3">
      {!onlyLinked && (
        <Input
          aria-label="Buscar transação"
          placeholder="Buscar por descrição"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      )}

      {/* Altura de 10 linhas de 2.75rem + divisórias e borda: trocar de página, buscar ou carregar não mexe na janela. */}
      <div className="h-[calc(10*2.75rem+11px)] overflow-hidden rounded-md border">
        {candidates.isPending && (
          <Skeleton className="h-full rounded-none" aria-busy="true" />
        )}
        {candidates.isError && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 p-3 text-sm"
          >
            Não foi possível carregar as transações.
            <Button
              variant="outline"
              size="sm"
              onClick={() => candidates.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        )}
        {data && data.items.length === 0 && (
          <p className="text-muted-foreground p-3 text-sm">
            Nenhuma transação encontrada.
          </p>
        )}
        {data && data.items.length > 0 && (
          <ul className="divide-y">
            {data.items.map((tx) => {
              const checkboxId = `link-${tx.id}`
              const elsewhere =
                tx.linkedTo && tx.linkedTo.id !== recurrence.id
                  ? tx.linkedTo
                  : null
              return (
                <li key={tx.id}>
                  <label
                    htmlFor={checkboxId}
                    className="hover:bg-muted/50 flex h-11 cursor-pointer items-center gap-3 px-3 text-sm"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="accent-primary size-4 shrink-0"
                      checked={isLinkedNow(tx)}
                      onChange={() => toggle(tx)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{tx.description}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {`${formatDate(tx.date)} · ${tx.account.name}`}
                        {elsewhere && ` · de: ${elsewhere.description}`}
                      </span>
                    </span>
                    <span className="w-28 shrink-0 text-right tabular-nums">
                      {formatBRL(tx.amountCents)}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </Button>
        <span className="text-muted-foreground">{`Página ${page} de ${lastPage}`}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </Button>
      </div>

      <DialogFooter>
        <Button
          disabled={toggled.size === 0 || save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Salvando…' : 'Salvar vínculos'}
        </Button>
      </DialogFooter>
    </div>
  )
}

/** Janela de escolha das transações do recorrente (ou só das vinculadas, em "ver todas"). */
export function RecurrenceLinkDialog({
  recurrence,
  onlyLinked = false,
  open,
  onOpenChange,
}: {
  recurrence: Recurrence
  onlyLinked?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Em tela baixa a janela ainda rola na vertical (o espaço da barra fica reservado para não empurrar o conteúdo); na horizontal, nunca. */}
      <DialogContent className="overflow-x-hidden [scrollbar-gutter:stable] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {onlyLinked
              ? `Transações de ${recurrence.description}`
              : 'Escolher transações'}
          </DialogTitle>
          <DialogDescription>
            {onlyLinked
              ? 'Desmarque para desvincular.'
              : recurrence.payrollDeduction
                ? 'Escolha o crédito do salário de cada mês em que a parcela foi descontada. Ele continua sendo do recorrente do salário.'
                : `${recurrence.direction === 'IN' ? 'Entradas' : 'Saídas'} do último ano, de todas as contas. As outras parcelas do mesmo padrão (mesmo valor, ou mesmo texto com valor parecido) vêm junto; marcar uma que já é de outro recorrente muda ela para este.`}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <LinkDialogBody
            recurrence={recurrence}
            onlyLinked={onlyLinked}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
