import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makePrismaMock, resetPrismaMocks } from '@/test/helpers'

const prismaMock = makePrismaMock()
const saveWhatsappEntry = vi.fn()
const undoWhatsappEntry = vi.fn()
const ensureWalletAccount = vi.fn()

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/services/wallet', () => ({ ensureWalletAccount }))
vi.mock('./save-entry', () => ({ saveWhatsappEntry, undoWhatsappEntry }))

const { handleWhatsappMessage, phoneVariants } = await import('./handle-message')
const { resetConversation } = await import('./conversation')
const { GeminiUnavailableError } = await import('@/lib/gemini/interpret-entry')

const draft = { description: 'Almoço', amountCents: -4500, date: '2026-10-23', category: null }
const accounts = [
  { id: 'a1', name: 'Nubank', type: 'BANK' },
  { id: 'a2', name: 'Itaú', type: 'BANK' },
]
const client = { sendText: vi.fn(), downloadMedia: vi.fn() }
const interpret = vi.fn()
const today = '2026-10-23'
const now = new Date('2026-10-23T15:00:00Z')

function run(msg: Record<string, unknown>, at = now) {
  return handleWhatsappMessage(
    { id: 'm1', from: '5511', ...msg },
    { client, interpret, today, now: at },
  )
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  vi.clearAllMocks()
  resetConversation()
  prismaMock.user.findFirst.mockResolvedValue({ id: 'u1' })
  prismaMock.account.findMany.mockResolvedValue(accounts)
  ensureWalletAccount.mockResolvedValue({ id: 'w', name: 'Carteira', type: 'WALLET' })
  saveWhatsappEntry.mockResolvedValue({
    kind: 'created',
    accountName: 'Nubank',
    accountType: 'BANK',
  })
})

const ask = () =>
  interpret.mockResolvedValueOnce({
    kind: 'ask_account',
    draft,
    candidateAccountIds: ['a1', 'a2'],
  })

describe('phoneVariants', () => {
  it('celular BR com 9 ganha a forma sem 9', () => {
    expect(phoneVariants('5511999999999')).toEqual(['5511999999999', '551199999999'])
  })
  it('celular BR sem 9 ganha a forma com 9', () => {
    expect(phoneVariants('551199999999')).toEqual(['551199999999', '5511999999999'])
  })
  it('número fora do Brasil fica igual', () => {
    expect(phoneVariants('14155550123')).toEqual(['14155550123'])
  })
})

describe('handleWhatsappMessage', () => {
  it('acha o usuário cadastrado com 13 dígitos quando from veio com 12', async () => {
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ from: '551199999999', text: 'almoço 45' })
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { whatsappPhone: { in: ['551199999999', '5511999999999'] } },
      }),
    )
    expect(client.sendText).toHaveBeenCalledWith('551199999999', expect.any(String))
  })

  it('número desconhecido: não responde e loga só os 4 últimos dígitos', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    const log = { info: vi.fn() }
    await handleWhatsappMessage(
      { id: 'm1', from: '551199999999', text: 'almoço 45' },
      { client, interpret, today, now, log },
    )
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info.mock.calls[0][0]).toContain('…9999')
    expect(log.info.mock.calls[0][0]).not.toContain('5511999')
    expect(client.sendText).not.toHaveBeenCalled()
    expect(interpret).not.toHaveBeenCalled()
  })

  it('tipo não suportado', async () => {
    await run({ unsupported: true })
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Por enquanto só entendo texto e foto de comprovante.',
    )
  })

  it('desfazer usa o último lançamento', async () => {
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ id: 'm0', text: 'almoço 45' })
    undoWhatsappEntry.mockResolvedValue({ kind: 'deleted' })
    await run({ id: 'm2', text: 'Desfazer' })
    expect(undoWhatsappEntry).toHaveBeenCalledWith('u1', 'm0')
    expect(client.sendText).toHaveBeenLastCalledWith('5511', '🗑️ Apagado.')
  })

  it('desfazer com pendente vivo cancela o pendente e não apaga nada', async () => {
    ask()
    await run({ text: 'almoço 45' })
    await run({ id: 'm2', text: 'desfazer' })
    expect(undoWhatsappEntry).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenLastCalledWith('5511', 'Cancelado.')
    interpret.mockResolvedValueOnce({ kind: 'not_understood', reply: 'Quanto foi?' })
    await run({ id: 'm3', text: '1' })
    expect(saveWhatsappEntry).not.toHaveBeenCalled()
    expect(interpret).toHaveBeenCalledTimes(2)
  })

  it('Carteira entre os candidatos aparece uma vez, por último', async () => {
    prismaMock.account.findMany.mockResolvedValue([
      ...accounts,
      { id: 'w', name: 'Carteira', type: 'WALLET' },
    ])
    interpret.mockResolvedValueOnce({
      kind: 'ask_account',
      draft,
      candidateAccountIds: ['a1', 'w', 'a1'],
    })
    await run({ text: 'almoço 45' })
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Almoço · R$ 45,00 — de qual conta?\n1) Nubank\n2) Dinheiro (Carteira)',
    )
  })

  it('entry: salva e responde', async () => {
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ text: 'almoço 45' })
    expect(saveWhatsappEntry).toHaveBeenCalledWith('u1', {
      draft,
      accountId: 'a1',
      messageId: 'm1',
    })
    expect(client.sendText.mock.calls[0][1]).toContain('✅ Almoço · R$ 45,00 · débito · Nubank · hoje')
  })

  it('ask_account: pergunta com a Carteira por último; "2" salva na 2ª com o messageId original', async () => {
    ask()
    await run({ text: 'almoço 45' })
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Almoço · R$ 45,00 — de qual conta?\n1) Nubank\n2) Itaú\n3) Dinheiro (Carteira)',
    )
    await run({ id: 'm2', text: '2' })
    expect(interpret).toHaveBeenCalledTimes(1)
    expect(saveWhatsappEntry).toHaveBeenCalledWith('u1', {
      draft,
      accountId: 'a2',
      messageId: 'm1',
    })
  })

  it('"2" sem pendente vai para o interpret como mensagem nova', async () => {
    interpret.mockResolvedValueOnce({ kind: 'not_understood', reply: 'Quanto foi?' })
    await run({ text: '2' })
    expect(interpret).toHaveBeenCalledTimes(1)
    expect(client.sendText).toHaveBeenCalledWith('5511', 'Quanto foi?')
  })

  it('pendente expirado vira mensagem nova', async () => {
    ask()
    await run({ text: 'almoço 45' })
    interpret.mockResolvedValueOnce({ kind: 'not_understood', reply: 'Quanto foi?' })
    await run({ id: 'm2', text: '2' }, new Date(now.getTime() + 31 * 60 * 1000))
    expect(saveWhatsappEntry).not.toHaveBeenCalled()
    expect(interpret).toHaveBeenCalledTimes(2)
  })

  it('resposta sem conta reconhecível descarta o pendente e segue como nova', async () => {
    ask()
    await run({ text: 'almoço 45' })
    interpret.mockResolvedValueOnce({ kind: 'not_understood', reply: 'Quanto foi?' })
    await run({ id: 'm2', text: 'café 5' })
    expect(interpret).toHaveBeenCalledTimes(2)
    expect(saveWhatsappEntry).not.toHaveBeenCalled()
  })

  it('duplicate: nada enviado', async () => {
    saveWhatsappEntry.mockResolvedValue({ kind: 'duplicate' })
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ text: 'almoço 45' })
    expect(client.sendText).not.toHaveBeenCalled()
  })

  it('Gemini fora', async () => {
    interpret.mockRejectedValueOnce(new GeminiUnavailableError('x'))
    await run({ text: 'almoço 45' })
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Não consegui entender agora, tenta de novo em instantes.',
    )
  })

  it('outros erros sobem', async () => {
    interpret.mockRejectedValueOnce(new Error('boom'))
    await expect(run({ text: 'x' })).rejects.toThrow('boom')
  })

  it('erro inesperado: avisa o usuário e relança', async () => {
    client.downloadMedia.mockRejectedValueOnce(new Error('boom'))
    await expect(run({ imageId: 'img1' })).rejects.toThrow('boom')
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Deu um erro aqui e não salvei. Tenta de novo em instantes.',
    )
  })

  it('erro ao salvar: avisa e relança, mesmo se o aviso falhar', async () => {
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    saveWhatsappEntry.mockRejectedValueOnce(new Error('db'))
    client.sendText.mockRejectedValueOnce(new Error('meta'))
    await expect(run({ text: 'almoço 45' })).rejects.toThrow('db')
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Deu um erro aqui e não salvei. Tenta de novo em instantes.',
    )
  })

  it('imagem: baixa a mídia e passa ao interpret', async () => {
    const data = Buffer.from('img')
    client.downloadMedia.mockResolvedValue({ data, mimeType: 'image/jpeg' })
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ imageId: 'img1' })
    expect(client.downloadMedia).toHaveBeenCalledWith('img1')
    expect(interpret.mock.calls[0][0].image).toEqual({ data, mimeType: 'image/jpeg' })
  })
})
