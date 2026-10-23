import { describe, expect, it } from 'vitest'

import { runExclusive } from './user-queue'

describe('runExclusive', () => {
  it('serializa tarefas do mesmo usuário', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const a = runExclusive('u1', async () => {
      order.push('a-start')
      await gate
      order.push('a-end')
    })
    const b = runExclusive('u1', async () => {
      order.push('b-start')
    })

    await Promise.resolve()
    release()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start'])
  })

  it('não trava a fila quando uma tarefa rejeita', async () => {
    const a = runExclusive('u2', async () => {
      throw new Error('falhou')
    })
    const b = runExclusive('u2', async () => 42)
    await expect(a).rejects.toThrow('falhou')
    await expect(b).resolves.toBe(42)
  })
})
