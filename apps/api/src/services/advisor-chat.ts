import type { FastifyBaseLogger } from 'fastify'

import { prisma } from '@/lib/prisma'
import type { IsoDate } from '@/lib/today'

import { type AdvisorAnswer, askAdvisor } from './ask-advisor'

/** A conversa do chat some depois disso (decisão do João). */
export const ADVISOR_CHAT_DAYS = 7

/** Mensagens anteriores que vão ao Gemini: dá para continuar o assunto sem inflar o pedido. */
const HISTORY_MESSAGES = 10

const DAY_MS = 24 * 60 * 60 * 1000

function chatCutoff(now: Date): Date {
  return new Date(now.getTime() - ADVISOR_CHAT_DAYS * DAY_MS)
}

/** Conversa dos últimos ADVISOR_CHAT_DAYS dias, mais antiga primeiro. */
export function loadAdvisorChat(userId: string, now = new Date()) {
  return prisma.advisorMessage.findMany({
    where: { userId, createdAt: { gte: chatCutoff(now) } },
    orderBy: { createdAt: 'asc' },
    select: { role: true, text: true, proposals: true },
  })
}

/** Pergunta no chat do app: guarda pergunta e resposta só quando há resposta, para dar para tentar de novo. */
export async function askInAdvisorChat(
  userId: string,
  question: string,
  today: IsoDate,
  deps: { log?: Pick<FastifyBaseLogger, 'info'>; now?: Date } = {},
): Promise<AdvisorAnswer> {
  const now = deps.now ?? new Date()
  await prisma.advisorMessage.deleteMany({ where: { userId, createdAt: { lt: chatCutoff(now) } } })
  const history = await loadAdvisorChat(userId, now)

  const result = await askAdvisor(userId, question, today, {
    log: deps.log,
    history: history.slice(-HISTORY_MESSAGES),
  })
  if (result.kind === 'answer') {
    await prisma.advisorMessage.createMany({
      data: [
        { userId, role: 'USER', text: question, createdAt: now },
        // 1 ms depois: a ordem por createdAt mantém a resposta após a pergunta.
        {
          userId,
          role: 'ASSISTANT',
          text: result.text,
          proposals: result.proposals.length > 0 ? result.proposals : undefined,
          createdAt: new Date(now.getTime() + 1),
        },
      ],
    })
  }
  return result
}
