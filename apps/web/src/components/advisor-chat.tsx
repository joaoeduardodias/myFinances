import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check } from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import { goalLabel, sameGoal } from '@/components/advisor-goals'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  type Advisor,
  type AdvisorMessage,
  acceptAdvisorGoal,
  askAdvisor,
  type GoalTarget,
} from '@/http/advisor'
import { cn } from '@/lib/utils'

const MAX_QUESTION = 300
/** O contador só aparece perto do limite, para não pesar o campo. */
const COUNTER_FROM = 250
const UNAVAILABLE = 'Perguntas indisponíveis no momento.'
const NO_ANSWER = 'Não consegui responder agora. Tente de novo.'
const SUGGESTIONS = [
  'Como está minha saúde financeira?',
  'Onde dá para economizar?',
  'Dá para gastar R$ 300 a mais este mês?',
]

function Proposal({
  target,
  goals,
}: {
  target: GoalTarget
  goals: Advisor['goals']
}) {
  const queryClient = useQueryClient()
  const accept = useMutation({
    mutationFn: () => acceptAdvisorGoal(target),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['advisor'] }),
  })
  const label = goalLabel(target)

  if (goals.some((goal) => sameGoal(goal.target, target))) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Check className="text-primary size-4" aria-hidden />
        <span>Meta aceita</span>
        <span className="sr-only">{`: ${label}`}</span>
      </p>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-auto self-start py-1.5 text-left whitespace-normal"
      disabled={accept.isPending}
      onClick={() => accept.mutate()}
      aria-label={`Aceitar meta: ${label}`}
    >
      {`Aceitar meta: ${label}`}
    </Button>
  )
}

function Message({
  message,
  goals,
}: {
  message: AdvisorMessage
  goals: Advisor['goals']
}) {
  if (message.role === 'USER') {
    return (
      <p className="bg-primary text-primary-foreground max-w-[85%] self-end rounded-2xl rounded-br-sm px-3 py-2 whitespace-pre-line">
        {message.text}
      </p>
    )
  }
  return (
    <div className="flex max-w-[95%] flex-col gap-2 self-start">
      <p className="leading-relaxed whitespace-pre-line">{message.text}</p>
      {message.proposals?.map((target) => (
        <Proposal
          key={target.kind === 'CATEGORY' ? target.category : 'SAVINGS'}
          target={target}
          goals={goals}
        />
      ))}
    </div>
  )
}

function Typing() {
  return (
    <div className="flex items-center gap-1 self-start py-2" role="status">
      <span className="sr-only">Consultor escrevendo…</span>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="bg-muted-foreground/60 size-1.5 rounded-full motion-safe:animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

export function AdvisorChat({ data }: { data: Advisor }) {
  const queryClient = useQueryClient()
  const [question, setQuestion] = useState('')
  const [noAnswer, setNoAnswer] = useState(false)
  const chatEnd = useRef<HTMLDivElement>(null)

  const ask = useMutation({
    mutationFn: (text: string) => askAdvisor(text),
    onSuccess: ({ answer, proposals }, text) => {
      if (answer === null) {
        // Nada foi guardado: devolve a pergunta ao campo e relê a cota.
        setNoAnswer(true)
        setQuestion(text)
        queryClient.invalidateQueries({ queryKey: ['advisor'] })
        return
      }
      queryClient.setQueryData<Advisor>(['advisor'], (old) =>
        old
          ? {
              ...old,
              messages: [
                ...old.messages,
                { role: 'USER', text, proposals: null },
                { role: 'ASSISTANT', text: answer, proposals },
              ],
            }
          : old,
      )
    },
    onError: (_error, text) => {
      setNoAnswer(true)
      setQuestion(text)
    },
  })

  const messageCount = data.messages.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola quando a conversa cresce
  useEffect(() => {
    chatEnd.current?.scrollIntoView?.({ block: 'nearest' })
  }, [messageCount, ask.isPending])

  const unavailable = !data.questionsAvailable
  const trimmed = question.trim()
  const empty = messageCount === 0 && !ask.isPending

  function send(text: string) {
    if (!text || unavailable || ask.isPending) return
    setNoAnswer(false)
    setQuestion('')
    ask.mutate(text)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    send(trimmed)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send(trimmed)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {empty ? (
        !unavailable && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <Button
                key={suggestion}
                variant="secondary"
                size="sm"
                className="h-auto rounded-full py-1.5 whitespace-normal"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )
      ) : (
        <div
          role="log"
          aria-label="Conversa com o consultor"
          aria-live="polite"
          className="-mx-2 flex max-h-[28rem] flex-col gap-4 overflow-y-auto px-2 py-1"
        >
          {data.messages.map((message, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a conversa só cresce no fim
            <Message key={index} message={message} goals={data.goals} />
          ))}
          {ask.isPending && (
            <>
              <Message
                message={{ role: 'USER', text: ask.variables, proposals: null }}
                goals={data.goals}
              />
              <Typing />
            </>
          )}
          <div ref={chatEnd} />
        </div>
      )}

      {unavailable ? (
        <p className="text-muted-foreground text-sm">{UNAVAILABLE}</p>
      ) : (
        noAnswer && <p className="text-destructive text-sm">{NO_ANSWER}</p>
      )}

      <form
        onSubmit={submit}
        className="focus-within:border-ring focus-within:ring-ring/50 border-input dark:bg-input/30 flex items-end gap-2 rounded-xl border p-1.5 focus-within:ring-[3px]"
      >
        <Textarea
          aria-label="Pergunte ao consultor"
          placeholder="Pergunte ao consultor"
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          rows={1}
          value={question}
          maxLength={MAX_QUESTION}
          disabled={unavailable}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {question.length >= COUNTER_FROM && (
          <span
            className={cn(
              'text-muted-foreground self-center text-xs tabular-nums',
              question.length >= MAX_QUESTION && 'text-destructive',
            )}
          >
            {`${question.length}/${MAX_QUESTION}`}
          </span>
        )}
        <Button
          type="submit"
          size="icon"
          className="size-8 shrink-0 rounded-lg"
          aria-label="Enviar"
          disabled={unavailable || !trimmed || ask.isPending}
        >
          <ArrowUp />
        </Button>
      </form>
    </div>
  )
}
