import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { NativeSelect } from '@/components/native-select'
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
import {
  type AnalysisExpense,
  getTransactionSimilar,
  saveTransactionRecurrence,
  setTransactionDescription,
  setTransactionNecessity,
  type TransactionNecessity,
} from '@/http/analysis'
import { listCategories, setTransactionCategory } from '@/http/transactions'
import { formatBRL, formatDate } from '@/lib/format'

interface Props {
  transaction: AnalysisExpense | null
  onClose: () => void
}

export function TransactionDialog({ transaction, onClose }: Props) {
  return (
    <Dialog
      open={transaction !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {transaction && (
        <TransactionForm
          key={transaction.id}
          transaction={transaction}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function TransactionForm({
  transaction,
  onClose,
}: {
  transaction: AnalysisExpense
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [description, setDescription] = useState(transaction.description)
  const [category, setCategory] = useState(transaction.category ?? '')
  const [necessity, setNecessity] = useState<TransactionNecessity | null>(
    transaction.necessity,
  )
  const [applyToSimilar, setApplyToSimilar] = useState(false)
  const [saveRecurrence, setSaveRecurrence] = useState(false)

  const similar = useQuery({
    queryKey: ['transaction-similar', transaction.id],
    queryFn: () => getTransactionSimilar(transaction.id),
  })
  const similarCount = similar.data?.similar ?? 0
  const isRecurrence = similar.data?.recurrenceStatus === 'CONFIRMED'
  const descriptionChanged =
    description.trim() !== transaction.description.trim()

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
  })
  const categoryNames = categories.data ?? []

  const save = useMutation({
    mutationFn: async () => {
      if (descriptionChanged) {
        await setTransactionDescription(
          transaction.id,
          description.trim(),
          applyToSimilar && similarCount > 0,
        )
      }
      // Depois da descrição: o recorrente leva o nome novo.
      if (saveRecurrence && !isRecurrence) {
        await saveTransactionRecurrence(transaction.id)
      }
      if (category && category !== (transaction.category ?? '')) {
        await setTransactionCategory(transaction.id, category)
      }
      if (necessity !== transaction.necessity) {
        await setTransactionNecessity(transaction.id, necessity)
      }
    },
    onSuccess: onClose,
    onSettled: () =>
      Promise.all(
        [
          'analysis',
          'analysis-transactions',
          'transactions',
          'dashboard',
          'recurrences',
          'transaction-similar',
        ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      ),
    onError: () =>
      toast.error('Não foi possível salvar a transação. Tente novamente.'),
  })

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Transação</DialogTitle>
        <DialogDescription>
          {formatDate(transaction.date)} · {transaction.accountName} ·{' '}
          {formatBRL(transaction.amountCents)}
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="transaction-description">Descrição</Label>
          <Input
            id="transaction-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {descriptionChanged && similarCount > 0 && (
            <CheckboxField
              id="transaction-apply-similar"
              checked={applyToSimilar}
              onChange={setApplyToSimilar}
            >
              Aplicar também às outras {similarCount}{' '}
              {similarCount === 1 ? 'parecida' : 'parecidas'} e às próximas
            </CheckboxField>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="transaction-category">Categoria</Label>
          <NativeSelect
            id="transaction-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {!category && (
              <option value="" disabled>
                Sem categoria
              </option>
            )}
            {category && !categoryNames.includes(category) && (
              <option value={category}>{category}</option>
            )}
            {categoryNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
        {transaction.amountCents <= 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="transaction-necessity">Marca</Label>
            <NativeSelect
              id="transaction-necessity"
              value={necessity ?? ''}
              onChange={(e) =>
                setNecessity(
                  (e.target.value || null) as TransactionNecessity | null,
                )
              }
            >
              <option value="">Padrão da categoria</option>
              <option value="ESSENTIAL">Essencial</option>
              <option value="AVOIDABLE">Evitável</option>
              <option value="EMERGENCY">Emergência</option>
            </NativeSelect>
          </div>
        )}
        {similar.data?.canSaveRecurrence && (
          <CheckboxField
            id="transaction-recurrence"
            checked={isRecurrence || saveRecurrence}
            disabled={isRecurrence}
            onChange={setSaveRecurrence}
          >
            {isRecurrence
              ? 'Já está nos recorrentes'
              : 'Salvar como recorrente'}
          </CheckboxField>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function CheckboxField({
  id,
  checked,
  disabled,
  onChange,
  children,
}: {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Label htmlFor={id} className="font-normal">
        {children}
      </Label>
    </div>
  )
}
