import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type Advisor,
  acceptAdvisorGoal,
  askAdvisor,
  clearAdvisorChat,
  endAdvisorGoal,
  getAdvisor,
} from '@/http/advisor'

import { AdvisorCard } from './advisor-card'

vi.mock('@/http/advisor', () => ({
  getAdvisor: vi.fn(),
  askAdvisor: vi.fn(),
  clearAdvisorChat: vi.fn(),
  acceptAdvisorGoal: vi.fn(),
  endAdvisorGoal: vi.fn(),
}))

function setup(advisor: Advisor) {
  vi.mocked(getAdvisor).mockResolvedValue(advisor)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <AdvisorCard today="2026-10-29" />
    </QueryClientProvider>,
  )
}

const withSummary: Advisor = {
  summary: { day: '2026-10-29', points: ['Mercado subiu 20%', 'Sobra R$ 300'] },
  questionsAvailable: true,
  messages: [],
  goals: [],
}

const withChat: Advisor = {
  ...withSummary,
  messages: [
    { role: 'USER', text: 'como estou?', proposals: null },
    {
      role: 'ASSISTANT',
      text: 'Atenção: Delivery subiu.',
      proposals: [
        { kind: 'CATEGORY', category: 'Delivery', targetCents: 30000 },
      ],
    },
  ],
}

const deliveryGoal = {
  id: 'g1',
  target: {
    kind: 'CATEGORY' as const,
    category: 'Delivery',
    targetCents: 30000,
  },
  startMonth: '2026-08',
  months: [
    { month: '2026-08', value: 42000, met: false, partial: false },
    { month: '2026-09', value: 25000, met: true, partial: false },
    { month: '2026-10', value: 12000, met: true, partial: true },
  ],
}

beforeEach(() => vi.clearAllMocks())

describe('AdvisorCard', () => {
  it('lista os pontos do resumo', async () => {
    setup(withSummary)
    expect(await screen.findByText('Mercado subiu 20%')).toBeInTheDocument()
    expect(screen.getByText('Sobra R$ 300')).toBeInTheDocument()
    expect(screen.queryByText(/Atualizado em/)).not.toBeInTheDocument()
  })

  it('mostra a data quando o resumo não é de hoje', async () => {
    setup({
      ...withSummary,
      summary: { day: '2026-10-27', points: ['Ponto'] },
    })
    expect(await screen.findByText('Atualizado em 27/10')).toBeInTheDocument()
  })

  it('sem resumo, mostra o texto de vazio', async () => {
    setup({ summary: null, questionsAvailable: true, messages: [], goals: [] })
    expect(
      await screen.findByText(
        'O resumo aparece depois da próxima sincronização.',
      ),
    ).toBeInTheDocument()
  })

  it('mostra a conversa guardada', async () => {
    setup(withChat)
    expect(await screen.findByText('como estou?')).toBeInTheDocument()
    expect(screen.getByText('Atenção: Delivery subiu.')).toBeInTheDocument()
  })

  it('pergunta, limpa o campo e acrescenta pergunta e resposta à conversa', async () => {
    setup(withChat)
    vi.mocked(askAdvisor).mockResolvedValue({
      answer: 'Corte R$ 200.',
      proposals: [],
    })
    const input = await screen.findByLabelText('Pergunte ao consultor')
    await userEvent.type(input, 'e o que corto?')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(await screen.findByText('Corte R$ 200.')).toBeInTheDocument()
    expect(screen.getByText('e o que corto?')).toBeInTheDocument()
    expect(screen.getByText('como estou?')).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(askAdvisor).toHaveBeenCalledWith('e o que corto?')
  })

  it('Enter envia e Shift+Enter quebra a linha', async () => {
    setup(withSummary)
    vi.mocked(askAdvisor).mockResolvedValue({ answer: 'ok', proposals: [] })
    const input = await screen.findByLabelText('Pergunte ao consultor')
    await userEvent.type(input, 'linha 1{Shift>}{Enter}{/Shift}linha 2{Enter}')
    expect(askAdvisor).toHaveBeenCalledWith('linha 1\nlinha 2')
  })

  it('answer null avisa e mantém a pergunta para tentar de novo', async () => {
    setup(withSummary)
    vi.mocked(askAdvisor).mockResolvedValue({ answer: null, proposals: [] })
    const input = await screen.findByLabelText('Pergunte ao consultor')
    await userEvent.type(input, 'oi?')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(
      await screen.findByText('Não consegui responder agora. Tente de novo.'),
    ).toBeInTheDocument()
    expect(input).toHaveValue('oi?')
  })

  it('Nova conversa apaga a conversa', async () => {
    setup(withChat)
    vi.mocked(clearAdvisorChat).mockResolvedValue(undefined)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Nova conversa' }),
    )
    expect(clearAdvisorChat).toHaveBeenCalled()
    expect(screen.queryByText('como estou?')).not.toBeInTheDocument()
  })

  it('sem conversa não mostra Nova conversa', async () => {
    setup(withSummary)
    await screen.findByText('Mercado subiu 20%')
    expect(
      screen.queryByRole('button', { name: 'Nova conversa' }),
    ).not.toBeInTheDocument()
  })

  it('questionsAvailable false desabilita o campo', async () => {
    setup({ ...withSummary, questionsAvailable: false })
    expect(await screen.findByLabelText('Pergunte ao consultor')).toBeDisabled()
    expect(
      screen.getByText('Perguntas indisponíveis no momento.'),
    ).toBeInTheDocument()
  })

  it('não envia pergunta vazia', async () => {
    setup(withSummary)
    await screen.findByText('Mercado subiu 20%')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  })

  it('não envia pergunta só com espaços (Enter)', async () => {
    setup(withSummary)
    const input = await screen.findByLabelText('Pergunte ao consultor')
    await userEvent.type(input, '   {Enter}')
    expect(askAdvisor).not.toHaveBeenCalled()
  })

  it('conversa vazia sugere perguntas que enviam ao clicar', async () => {
    setup(withSummary)
    vi.mocked(askAdvisor).mockResolvedValue({ answer: 'ok', proposals: [] })
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Como está minha saúde financeira?',
      }),
    )
    expect(askAdvisor).toHaveBeenCalledWith('Como está minha saúde financeira?')
  })

  it('aceitar meta proposta chama a API e mostra como aceita', async () => {
    setup(withChat)
    vi.mocked(acceptAdvisorGoal).mockResolvedValue({ id: 'g1' })
    vi.mocked(getAdvisor).mockResolvedValue({
      ...withChat,
      goals: [deliveryGoal],
    })
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Aceitar meta: Delivery até R$ 300,00 por mês',
      }),
    )
    expect(acceptAdvisorGoal).toHaveBeenCalledWith({
      kind: 'CATEGORY',
      category: 'Delivery',
      targetCents: 30000,
    })
    expect(await screen.findByText('Meta aceita')).toBeInTheDocument()
  })

  it('lista metas com o mês atual e o histórico, e encerra', async () => {
    setup({ ...withSummary, goals: [deliveryGoal] })
    expect(
      await screen.findByText('Delivery até R$ 300,00 por mês'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('R$ 120,00 de R$ 300,00 neste mês'),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('agosto de 2026: estourou (R$ 420,00)'),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('setembro de 2026: cumpriu (R$ 250,00)'),
    ).toBeInTheDocument()
    vi.mocked(endAdvisorGoal).mockResolvedValue(undefined)
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Encerrar meta Delivery até R$ 300,00 por mês',
      }),
    )
    expect(endAdvisorGoal).toHaveBeenCalledWith('g1')
  })

  it('meta de sobra mostra a % do mês', async () => {
    setup({
      ...withSummary,
      goals: [
        {
          id: 'g2',
          target: { kind: 'SAVINGS', targetPercent: 20 },
          startMonth: '2026-10',
          months: [{ month: '2026-10', value: 12, met: false, partial: true }],
        },
      ],
    })
    expect(await screen.findByText('Guardar 20% da renda')).toBeInTheDocument()
    expect(
      screen.getByText('12% guardado neste mês, até agora'),
    ).toBeInTheDocument()
  })
})
