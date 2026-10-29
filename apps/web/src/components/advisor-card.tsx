import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'

import { AdvisorChat } from '@/components/advisor-chat'
import { AdvisorGoals } from '@/components/advisor-goals'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { type Advisor, clearAdvisorChat, getAdvisor } from '@/http/advisor'
import { formatDate } from '@/lib/format'
import type { IsoDate } from '@/lib/types'

export function AdvisorCard({ today }: { today: IsoDate }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['advisor'],
    queryFn: getAdvisor,
  })
  const clear = useMutation({
    mutationFn: clearAdvisorChat,
    onSuccess: () =>
      queryClient.setQueryData<Advisor>(['advisor'], (old) =>
        old ? { ...old, messages: [] } : old,
      ),
  })

  // Erro no GET não derruba o Início: o card some.
  if (!data) return null

  return (
    <Card>
      <CardHeader>
        <CardDescription>Consultor</CardDescription>
        {data.messages.length > 0 && (
          <CardAction>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={clear.isPending}
              onClick={() => clear.mutate()}
            >
              <RotateCcw />
              Nova conversa
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {data.summary ? (
          <div className="flex flex-col gap-2">
            <ul className="marker:text-muted-foreground list-disc space-y-1.5 pl-5">
              {data.summary.points.map((point, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: pontos podem repetir
                <li key={`${index}-${point}`}>{point}</li>
              ))}
            </ul>
            {data.summary.day !== today && (
              <p className="text-muted-foreground text-sm">
                {`Atualizado em ${formatDate(data.summary.day).slice(0, 5)}`}
              </p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            O resumo aparece depois da próxima sincronização.
          </p>
        )}

        <AdvisorGoals goals={data.goals} />

        <Separator />

        <AdvisorChat data={data} />
      </CardContent>
    </Card>
  )
}
