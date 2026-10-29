import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type Advisor, askAdvisor, getAdvisor } from '@/http/advisor'

import { AdvisorCard } from './advisor-card'

vi.mock('@/http/advisor', () => ({
  getAdvisor: vi.fn(),
  askAdvisor: vi.fn(),
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
    setup({ summary: null, questionsAvailable: true })
    expect(
      await screen.findByText(
        'O resumo aparece depois da próxima sincronização.',
      ),
    ).toBeInTheDocument()
  })

  it('pergunta e mostra a resposta', async () => {
    setup(withSummary)
    vi.mocked(askAdvisor).mockResolvedValue({ answer: 'Dá, sobra R$ 300.' })
    await userEvent.type(
      await screen.findByLabelText('Pergunte ao consultor'),
      'dá pra comprar um tênis de 300?',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Perguntar' }))
    expect(await screen.findByText('Dá, sobra R$ 300.')).toBeInTheDocument()
    expect(askAdvisor).toHaveBeenCalledWith('dá pra comprar um tênis de 300?')
  })

  it('answer null mostra indisponível', async () => {
    setup(withSummary)
    vi.mocked(askAdvisor).mockResolvedValue({ answer: null })
    await userEvent.type(
      await screen.findByLabelText('Pergunte ao consultor'),
      'oi?',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Perguntar' }))
    expect(
      await screen.findByText('Perguntas indisponíveis no momento.'),
    ).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Perguntar' })).toBeDisabled()
  })
})
