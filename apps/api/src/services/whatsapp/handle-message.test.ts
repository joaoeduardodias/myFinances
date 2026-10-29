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
const { ADVISOR_DOWN_REPLY } = await import('./replies')

const draft = { description: 'Almoço', amountCents: -4500, date: '2026-10-23', category: null }
const accounts = [
  { id: 'a1', name: 'Nubank', type: 'BANK' },
  { id: 'a2', name: 'Itaú', type: 'BANK' },
]
const client = { sendText: vi.fn(), downloadMedia: vi.fn() }
const interpret = vi.fn()
const askAdvisor = vi.fn()
const today = '2026-10-23'
const now = new Date('2026-10-23T15:00:00Z')

function run(msg: Record<string, unknown>, at = now) {
  return handleWhatsappMessage(
    { id: 'm1', from: '5511', ...msg },
    { client, interpret, askAdvisor, today, now: at },
  )
}

beforeEach(() => {
  resetPrismaMocks(prismaMock)
  vi.clearAllMocks()
  resetConversation()
  prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', whatsappPhone: '5511' })
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
  it('acha o usuário cadastrado com 13 dígitos quando from veio com 12 e responde ao cadastrado', async () => {
    // O número de teste da Meta só envia para a lista de permissão, que guarda
    // o número com o 9; responder ao `from` sem o 9 dá erro 131030.
    prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', whatsappPhone: '5511999999999' })
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ from: '551199999999', text: 'almoço 45' })
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { whatsappPhone: { in: ['551199999999', '5511999999999'] } },
      }),
    )
    expect(client.sendText).toHaveBeenCalledWith('5511999999999', expect.any(String))
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

  describe('opções da pergunta', () => {
    const caixaBradesco = [
      { id: 'pc', name: 'Conta Poupança Caixa', type: 'BANK' },
      { id: 'kc', name: 'Cartão Crédito Caixa', type: 'CREDIT' },
      { id: 'cc', name: 'Conta Corrente Caixa', type: 'BANK' },
      { id: 'cb', name: 'Conta Corrente Bradesco', type: 'BANK' },
      { id: 'pb', name: 'Conta Poupança Bradesco', type: 'BANK' },
    ]
    beforeEach(() => prismaMock.account.findMany.mockResolvedValue(caixaBradesco))
    const askWith = (ids: string[]) =>
      interpret.mockResolvedValueOnce({ kind: 'ask_account', draft, candidateAccountIds: ids })

    it('sem falar em poupança: tira a poupança e põe corrente antes de cartão', async () => {
      askWith(['pc', 'kc', 'cc', 'cb', 'pb'])
      await run({ text: 'almoço 45' })
      expect(client.sendText).toHaveBeenCalledWith(
        '5511',
        'Almoço · R$ 45,00 — de qual conta?\n1) Conta Corrente Caixa\n2) Conta Corrente Bradesco\n3) Cartão Crédito Caixa\n4) Dinheiro (Carteira)',
      )
    })

    it('sobrou uma conta só depois de tirar a poupança: salva direto', async () => {
      askWith(['pb', 'cb'])
      await run({ text: 'almoço 45 débito bradesco' })
      expect(saveWhatsappEntry).toHaveBeenCalledWith('u1', { draft, accountId: 'cb', messageId: 'm1' })
    })

    it('falou em débito: lista só as correntes, sem cartão nem Carteira', async () => {
      askWith(['kc', 'cc'])
      await run({ text: 'almoço 45 no débito' })
      expect(client.sendText).toHaveBeenCalledWith(
        '5511',
        'Almoço · R$ 45,00 — de qual conta?\n1) Conta Corrente Caixa\n2) Conta Corrente Bradesco',
      )
    })

    it('falou em débito e só há uma corrente: salva direto', async () => {
      prismaMock.account.findMany.mockResolvedValue(caixaBradesco.filter((a) => a.id !== 'cb'))
      askWith(['kc', 'cc', 'pc'])
      await run({ text: 'almoço 45 debito' })
      expect(saveWhatsappEntry).toHaveBeenCalledWith('u1', { draft, accountId: 'cc', messageId: 'm1' })
    })

    it('falou em poupança: ela fica, depois das correntes', async () => {
      askWith(['pc', 'cc'])
      await run({ text: 'almoço 45 pix da poupança' })
      expect(client.sendText).toHaveBeenCalledWith(
        '5511',
        'Almoço · R$ 45,00 — de qual conta?\n1) Conta Corrente Caixa\n2) Conta Poupança Caixa\n3) Dinheiro (Carteira)',
      )
    })
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

  it('Gemini fora: avisa o usuário e loga o motivo', async () => {
    interpret.mockRejectedValueOnce(new GeminiUnavailableError('Gemini respondeu 404'))
    const log = { info: vi.fn() }
    await handleWhatsappMessage(
      { id: 'm1', from: '5511', text: 'almoço 45' },
      { client, interpret, today, now, log },
    )
    expect(client.sendText).toHaveBeenCalledWith(
      '5511',
      'Não consegui entender agora, tenta de novo em instantes.',
    )
    expect(log.info.mock.calls[0][0]).toContain('Gemini respondeu 404')
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

describe('perguntas ao consultor', () => {
  it('texto que termina em ? vai direto ao consultor, sem interpret', async () => {
    askAdvisor.mockResolvedValueOnce({ kind: 'answer', text: 'Dá, sobram R$ 900.' })
    await run({ text: 'dá pra comprar um tênis de 300?' })
    expect(askAdvisor).toHaveBeenCalledWith('u1', 'dá pra comprar um tênis de 300?', today)
    expect(interpret).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith('5511', 'Dá, sobram R$ 900.')
  })

  it('lançamento com ? no fim também vai ao consultor', async () => {
    askAdvisor.mockResolvedValueOnce({ kind: 'answer', text: 'ok' })
    await run({ text: 'almoço 45 pix nubank?' })
    expect(askAdvisor).toHaveBeenCalled()
    expect(interpret).not.toHaveBeenCalled()
    expect(saveWhatsappEntry).not.toHaveBeenCalled()
  })

  it('interpret devolvendo question chama o consultor', async () => {
    interpret.mockResolvedValueOnce({ kind: 'question' })
    askAdvisor.mockResolvedValueOnce({ kind: 'answer', text: 'Gastou R$ 10.' })
    await run({ text: 'quanto gastei com mercado' })
    expect(askAdvisor).toHaveBeenCalledWith('u1', 'quanto gastei com mercado', today)
    expect(client.sendText).toHaveBeenCalledWith('5511', 'Gastou R$ 10.')
  })

  it('consultor indisponível responde ADVISOR_DOWN_REPLY', async () => {
    askAdvisor.mockResolvedValueOnce({ kind: 'unavailable' })
    await run({ text: 'posso gastar mais?' })
    expect(client.sendText).toHaveBeenCalledWith('5511', ADVISOR_DOWN_REPLY)
  })

  it('foto com legenda ? segue para interpret', async () => {
    client.downloadMedia.mockResolvedValue({ data: Buffer.from('x'), mimeType: 'image/jpeg' })
    interpret.mockResolvedValueOnce({ kind: 'not_understood', reply: 'r' })
    await run({ text: 'isso?', imageId: 'img' })
    expect(askAdvisor).not.toHaveBeenCalled()
    expect(interpret).toHaveBeenCalled()
  })

  it('"desfazer?" desfaz, sem ir ao consultor', async () => {
    interpret.mockResolvedValueOnce({ kind: 'entry', draft, accountId: 'a1' })
    await run({ id: 'm0', text: 'almoço 45' })
    undoWhatsappEntry.mockResolvedValue({ kind: 'deleted' })
    await run({ id: 'm2', text: 'desfazer?' })
    expect(undoWhatsappEntry).toHaveBeenCalledWith('u1', 'm0')
    expect(askAdvisor).not.toHaveBeenCalled()
  })

  it('"1?" com pendente escolhe a conta, sem ir ao consultor', async () => {
    ask()
    await run({ text: 'almoço 45' })
    await run({ id: 'm2', text: '1?' })
    expect(saveWhatsappEntry).toHaveBeenCalledWith('u1', expect.objectContaining({ accountId: 'a1' }))
    expect(askAdvisor).not.toHaveBeenCalled()
  })

  it('foto sem texto que o interpret lê como pergunta pede a pergunta por escrito', async () => {
    client.downloadMedia.mockResolvedValue({ data: Buffer.from('x'), mimeType: 'image/jpeg' })
    interpret.mockResolvedValueOnce({ kind: 'question' })
    await run({ imageId: 'img' })
    expect(askAdvisor).not.toHaveBeenCalled()
    expect(client.sendText).toHaveBeenCalledWith('5511', 'Manda a pergunta por escrito que eu respondo.')
  })

  it('GeminiUnavailableError do consultor cai em GEMINI_DOWN_REPLY', async () => {
    askAdvisor.mockRejectedValueOnce(new GeminiUnavailableError('x'))
    await run({ text: 'posso gastar mais?' })
    expect(client.sendText).toHaveBeenCalledWith('5511', expect.stringContaining('Não consegui'))
  })
})
