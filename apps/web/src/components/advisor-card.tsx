import { useMutation, useQuery } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { askAdvisor, getAdvisor } from '@/http/advisor'
import { formatDate } from '@/lib/format'
import type { IsoDate } from '@/lib/types'

const UNAVAILABLE = 'Perguntas indisponíveis no momento.'

export function AdvisorCard({ today }: { today: IsoDate }) {
  const [question, setQuestion] = useState('')
  const { data, isError } = useQuery({
    queryKey: ['advisor'],
    queryFn: getAdvisor,
  })
  const ask = useMutation({
    mutationFn: (text: string) => askAdvisor(text),
  })

  // Erro no GET não derruba o Início: o card some.
  if (isError || !data) return null

  const trimmed = question.trim()
  const unavailable =
    !data.questionsAvailable || (ask.isSuccess && ask.data.answer === null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trimmed) ask.mutate(trimmed)
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>Consultor</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.summary ? (
          <div className="flex flex-col gap-2">
            <ul className="list-disc space-y-1 pl-5">
              {data.summary.points.map((point) => (
                <li key={point}>{point}</li>
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

        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="advisor-question" className="text-sm font-medium">
            Pergunte ao consultor
          </label>
          <div className="flex gap-2">
            <Input
              id="advisor-question"
              value={question}
              maxLength={300}
              disabled={!data.questionsAvailable}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button
              type="submit"
              disabled={!data.questionsAvailable || !trimmed || ask.isPending}
            >
              Perguntar
            </Button>
          </div>
        </form>

        {ask.isPending && <p className="text-muted-foreground">Pensando…</p>}
        {ask.isSuccess && ask.data.answer && (
          <p className="whitespace-pre-line">{ask.data.answer}</p>
        )}
        {(unavailable || ask.isError) && (
          <p className="text-muted-foreground">{UNAVAILABLE}</p>
        )}
      </CardContent>
    </Card>
  )
}
