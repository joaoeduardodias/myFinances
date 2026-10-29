import { describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('./api', () => ({ api: { post } }))

const { askAdvisor } = await import('./advisor')

// A API espera o Gemini até 60 s (duas vezes em 503): os 10 s padrão do ky cortariam antes.
describe('askAdvisor', () => {
  it('espera mais que as duas tentativas da API', async () => {
    post.mockReturnValue({ json: async () => ({ answer: 'ok' }) })

    await askAdvisor('oi')

    expect(post).toHaveBeenCalledWith('advisor/questions', {
      json: { question: 'oi' },
      timeout: 130_000,
    })
  })
})
