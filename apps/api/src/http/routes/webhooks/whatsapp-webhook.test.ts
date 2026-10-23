import { createHmac } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTestApp } from '@/test/helpers'

const handleMock = vi.fn()
vi.mock('@/services/whatsapp/handle-message', () => ({
  handleWhatsappMessage: handleMock,
}))

const { extractMessages, registerWhatsappWebhook, verifyMetaSignature } =
  await import('./whatsapp-webhook')

const cfg = {
  accessToken: 'tok',
  appSecret: 'segredo-do-app',
  verifyToken: 'verifica',
  phoneNumberId: '99',
}

function payload(value: object) {
  return { object: 'whatsapp_business_account', entry: [{ changes: [{ value }] }] }
}
const textValue = {
  metadata: { phone_number_id: '99' },
  messages: [{ id: 'wamid.1', from: '5511999999999', type: 'text', text: { body: 'mercado 50' } }],
}

function sign(raw: string, secret = cfg.appSecret) {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
}

async function appWith(c: typeof cfg | undefined) {
  return buildTestApp(async (app) => registerWhatsappWebhook(app, c))
}

async function post(body: string, headers: Record<string, string> = {}, c: typeof cfg | null = cfg) {
  const app = await appWith(c ?? undefined)
  const response = await app.inject({
    method: 'POST',
    url: '/webhooks/whatsapp',
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  })
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return response
}

beforeEach(() => {
  vi.resetAllMocks()
  handleMock.mockResolvedValue(undefined)
})

describe('GET /webhooks/whatsapp', () => {
  const url = (token: string) =>
    `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=abc123`

  it('token certo → 200 com o challenge', async () => {
    const app = await appWith(cfg)
    const response = await app.inject({ method: 'GET', url: url('verifica') })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('abc123')
  })

  it('token errado → 403', async () => {
    const app = await appWith(cfg)
    const response = await app.inject({ method: 'GET', url: url('errado') })
    expect(response.statusCode).toBe(403)
  })
})

describe('POST /webhooks/whatsapp', () => {
  it('sem assinatura → 401, handler não chamado', async () => {
    const response = await post(JSON.stringify(payload(textValue)))
    expect(response.statusCode).toBe(401)
    expect(handleMock).not.toHaveBeenCalled()
  })

  it('assinatura errada → 401, handler não chamado', async () => {
    const raw = JSON.stringify(payload(textValue))
    const response = await post(raw, { 'x-hub-signature-256': sign(raw, 'outro') })
    expect(response.statusCode).toBe(401)
    expect(handleMock).not.toHaveBeenCalled()
  })

  it('assinado com texto → 200 e handler chamado', async () => {
    const raw = JSON.stringify(payload(textValue))
    const response = await post(raw, { 'x-hub-signature-256': sign(raw) })
    expect(response.statusCode).toBe(200)
    expect(handleMock).toHaveBeenCalledTimes(1)
    expect(handleMock.mock.calls[0][0]).toEqual({
      id: 'wamid.1',
      from: '5511999999999',
      text: 'mercado 50',
    })
  })

  it('erro do handler é engolido (só log)', async () => {
    handleMock.mockRejectedValue(new Error('boom'))
    const raw = JSON.stringify(payload(textValue))
    const response = await post(raw, { 'x-hub-signature-256': sign(raw) })
    expect(response.statusCode).toBe(200)
  })

  it('só statuses → handler não chamado', async () => {
    const raw = JSON.stringify(payload({ metadata: { phone_number_id: '99' }, statuses: [{ id: 'x' }] }))
    const response = await post(raw, { 'x-hub-signature-256': sign(raw) })
    expect(response.statusCode).toBe(200)
    expect(handleMock).not.toHaveBeenCalled()
  })

  it('phone_number_id diferente → handler não chamado', async () => {
    const raw = JSON.stringify(payload({ ...textValue, metadata: { phone_number_id: '1' } }))
    await post(raw, { 'x-hub-signature-256': sign(raw) })
    expect(handleMock).not.toHaveBeenCalled()
  })

  it('JSON inválido com assinatura válida → 400', async () => {
    const raw = '{nao-json'
    const response = await post(raw, { 'x-hub-signature-256': sign(raw) })
    expect(response.statusCode).toBe(400)
  })

  it('sem configuração a rota não existe → 404', async () => {
    const response = await post('{}', {}, null)
    expect(response.statusCode).toBe(404)
  })
})

describe('extractMessages', () => {
  it('imagem vira imageId com a legenda em text; outros tipos são unsupported', () => {
    const msgs = extractMessages(
      payload({
        metadata: { phone_number_id: '99' },
        messages: [
          { id: 'a', from: '1', type: 'image', image: { id: 'img1', caption: 'nota' } },
          { id: 'b', from: '1', type: 'audio', audio: { id: 'z' } },
        ],
      }),
      '99',
    )
    expect(msgs).toEqual([
      { id: 'a', from: '1', imageId: 'img1', text: 'nota' },
      { id: 'b', from: '1', unsupported: true },
    ])
  })

  it('lixo vira lista vazia', () => {
    expect(extractMessages(null, '99')).toEqual([])
    expect(extractMessages({ entry: 'x' }, '99')).toEqual([])
  })
})

describe('verifyMetaSignature', () => {
  it('rejeita header ausente ou de tamanho diferente sem lançar', () => {
    const raw = Buffer.from('{}')
    expect(verifyMetaSignature(raw, undefined, 's')).toBe(false)
    expect(verifyMetaSignature(raw, 'sha256=abc', 's')).toBe(false)
    expect(verifyMetaSignature(raw, sign('{}', 's'), 's')).toBe(true)
  })
})
