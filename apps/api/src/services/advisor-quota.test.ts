import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const { takeAdvisorCall } = await import('./advisor-quota')

describe('takeAdvisorCall', () => {
  beforeEach(() => resetPrismaMocks(prismaMock))

  it('conta uma chamada no dia', async () => {
    prismaMock.advisorUsage.upsert.mockResolvedValue({ day: '2026-10-29', calls: 1 })
    await takeAdvisorCall('2026-10-29')
    expect(prismaMock.advisorUsage.upsert).toHaveBeenCalledWith({
      where: { day: '2026-10-29' },
      create: { day: '2026-10-29', calls: 1 },
      update: { calls: { increment: 1 } },
    })
  })

  it('libera até 100 e bloqueia a partir da 101', async () => {
    prismaMock.advisorUsage.upsert.mockResolvedValueOnce({ day: 'd', calls: 100 })
    expect(await takeAdvisorCall('2026-10-29')).toBe(true)
    prismaMock.advisorUsage.upsert.mockResolvedValueOnce({ day: 'd', calls: 101 })
    expect(await takeAdvisorCall('2026-10-29')).toBe(false)
  })

  it('tenta de novo uma vez no conflito de unique', async () => {
    prismaMock.advisorUsage.upsert
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockResolvedValueOnce({ day: 'd', calls: 2 })
    expect(await takeAdvisorCall('2026-10-29')).toBe(true)
    expect(prismaMock.advisorUsage.upsert).toHaveBeenCalledTimes(2)
  })

  it('não insiste no segundo conflito', async () => {
    prismaMock.advisorUsage.upsert.mockRejectedValue({ code: 'P2002' })
    await expect(takeAdvisorCall('2026-10-29')).rejects.toEqual({ code: 'P2002' })
    expect(prismaMock.advisorUsage.upsert).toHaveBeenCalledTimes(2)
  })
})
