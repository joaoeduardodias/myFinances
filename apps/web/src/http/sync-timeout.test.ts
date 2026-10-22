import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.fn()
vi.mock('./api', () => ({ api: { post } }))

const { createConnection, syncConnection } = await import('./connections')
const { syncAll } = await import('./dashboard')

// Adicionar e sincronizar leem um ano da Pluggy: os 10 s padrão do ky não bastam.
describe('chamadas que sincronizam com a Pluggy', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockReturnValue({ json: async () => ({ synced: 0 }) })
  })

  it('POST /connections espera até 2 minutos', async () => {
    await createConnection('item')
    expect(post).toHaveBeenCalledWith('connections', {
      json: { itemId: 'item' },
      timeout: 120_000,
    })
  })

  it('POST /connections/:id/sync espera até 2 minutos', async () => {
    await syncConnection('c1')
    expect(post).toHaveBeenCalledWith('connections/c1/sync', { timeout: 120_000 })
  })

  it('POST /sync espera até 2 minutos', async () => {
    await syncAll(true)
    expect(post).toHaveBeenCalledWith('sync', {
      searchParams: { force: true },
      timeout: 120_000,
    })
  })
})
