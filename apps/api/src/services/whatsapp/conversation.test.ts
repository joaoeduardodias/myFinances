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

  it('resposta que contém o nome distintivo', () => {
    expect(resolveAccountAnswer('foi no nubank mesmo', options)).toBe('a1')
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
