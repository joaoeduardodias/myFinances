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

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
  })
  const categoryNames = categories.data ?? []

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = description.trim()
      if (trimmed !== transaction.description) {
        await setTransactionDescription(transaction.id, trimmed)
      }
      if (category && category !== (transaction.category ?? '')) {
        await setTransactionCategory(transaction.id, category)
      }
      if (necessity !== transaction.necessity) {
        await setTransactionNecessity(transaction.id, necessity)
      }
    },
    onSuccess: async () => {
      await Promise.all(
        ['analysis', 'analysis-transactions', 'transactions', 'dashboard'].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
      onClose()
    },
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
