import { beforeEach, describe, expect, it } from 'vitest'

import {
  type AccountOption,
  isUndo,
  lastEntry,
  PENDING_TTL_MS,
  rememberLastEntry,
  resetConversation,
  resolveAccountAnswer,
  setPending,
  takePending,
} from './conversation'

const options: AccountOption[] = [
  { accountId: 'a1', label: 'Conta Corrente Nubank' },
  { accountId: 'a2', label: 'Conta Corrente Itaú' },
  { accountId: 'w', label: 'Dinheiro (Carteira)' },
]
const draft = { description: 'Almoço', amountCents: -4500, date: '2026-10-23', category: null }

beforeEach(() => resetConversation())

describe('pendente', () => {
  it('devolve e remove o pendente', () => {
    const at = new Date('2026-10-23T12:00:00Z')
    setPending('u', { draft, options, messageId: 'm1', at })
    expect(takePending('u', at)?.messageId).toBe('m1')
    expect(takePending('u', at)).toBeUndefined()
  })

  it('expira depois de 30 minutos', () => {
    const at = new Date('2026-10-23T12:00:00Z')
    setPending('u', { draft, options, messageId: 'm1', at })
    expect(takePending('u', new Date(at.getTime() + PENDING_TTL_MS + 1))).toBeUndefined()
    expect(takePending('u', at)).toBeUndefined()
  })
})

describe('resolveAccountAnswer', () => {
  it('por número', () => {
    expect(resolveAccountAnswer('2', options)).toBe('a2')
    expect(resolveAccountAnswer('7', options)).toBeNull()
    expect(resolveAccountAnswer('0', options)).toBeNull()
  })

  it('por nome, sem acento nem caixa', () => {
    expect(resolveAccountAnswer('nubank', options)).toBe('a1')
    expect(resolveAccountAnswer('ITAU', options)).toBe('a2')
    expect(resolveAccountAnswer('dinheiro', options)).toBe('w')
  })

  it('ambíguo ou desconhecido vira null', () => {
    expect(resolveAccountAnswer('conta corrente', options)).toBeNull()
    expect(resolveAccountAnswer('bradesco', options)).toBeNull()
  })

  it('mesmo banco com corrente e poupança: o nome sozinho fica com a corrente', () => {
    const caixa: AccountOption[] = [
      { accountId: 'cp', label: 'Conta Poupança Caixa' },
      { accountId: 'cc', label: 'Conta Corrente Caixa' },
      { accountId: 'card', label: 'Cartão Crédito Caixa' },
    ]
    expect(resolveAccountAnswer('caixa', caixa)).toBe('cc')
    expect(resolveAccountAnswer('poupança caixa', caixa)).toBe('cp')
    expect(resolveAccountAnswer('cartão caixa', caixa)).toBe('card')
  })

  it('resposta curta com o nome e palavras genéricas', () => {
    expect(resolveAccountAnswer('na conta nubank', options)).toBe('a1')
    expect(resolveAccountAnswer(' 2 ', options)).toBe('a2')
    expect(resolveAccountAnswer('carteira', options)).toBe('w')
  })

  it('mensagem nova ou pedaço de palavra não é resposta', () => {
    expect(resolveAccountAnswer('ta', options)).toBeNull()
    expect(resolveAccountAnswer('café 5 itau', options)).toBeNull()
    expect(resolveAccountAnswer('almoço 45 pix nubank', options)).toBeNull()
    expect(resolveAccountAnswer('foi no nubank mesmo', options)).toBeNull()
    expect(resolveAccountAnswer('itau', options)).toBe('a2')
  })
})

describe('desfazer', () => {
  it('reconhece variações', () => {
    expect(isUndo('Desfazer')).toBe(true)
    expect(isUndo(' apaga ')).toBe(true)
    expect(isUndo('APAGAR')).toBe(true)
    expect(isUndo('almoço 45')).toBe(false)
  })

  it('lembra o último lançamento', () => {
    expect(lastEntry('u')).toBeUndefined()
    rememberLastEntry('u', 'm9')
    expect(lastEntry('u')).toBe('m9')
  })
})
