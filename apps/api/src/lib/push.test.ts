import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()
const sendNotification = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('web-push', () => ({ default: { sendNotification } }))

const { sendPush } = await import('./push')

const notification = { id: 'n1', title: 'Mercado em 80%', body: 'Você usou 80% do limite.' }
const subscription = (id: string) => ({ id, endpoint: `https://push.test/${id}`, p256dh: 'p', auth: 'a' })

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  sendNotification.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('sendPush', () => {
  it('envia cada aviso para cada inscrição do usuário', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([subscription('s1'), subscription('s2')])
    sendNotification.mockResolvedValue({})

    await sendPush('user-1', [notification])

    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.test/s1', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify(notification),
      expect.objectContaining({ TTL: 86400 }),
    )
    expect(prismaMock.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('apaga só as inscrições que o serviço deu como expiradas', async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([
      subscription('s1'),
      subscription('s2'),
      subscription('s3'),
    ])
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error('rede'), { statusCode: 500 }))
      .mockResolvedValueOnce({})

    await expect(sendPush('user-1', [notification])).resolves.toBeUndefined()

    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s1'] } } })
  })

  it('não lança quando o banco falha', async () => {
    prismaMock.pushSubscription.findMany.mockRejectedValue(new Error('db fora'))
    await expect(sendPush('user-1', [notification])).resolves.toBeUndefined()
  })

  it('não consulta nada sem aviso novo', async () => {
    await sendPush('user-1', [])
    expect(prismaMock.pushSubscription.findMany).not.toHaveBeenCalled()
  })
})
