import { describe, expect, it } from 'vitest'

import { askAccountReply, renamedReply, savedReply, undoReply } from './replies'

const base = {
  description: 'Almoço',
  amountCents: -4500,
  accountName: 'Conta Corrente Nubank',
  date: '2026-10-23',
  category: 'Alimentação',
}

describe('replies', () => {
  it('salvo', () => {
    expect(savedReply(base, '2026-10-23')).toBe(
      '✅ Almoço · R$ 45,00 · débito · Conta Corrente Nubank · hoje · Alimentação\nResponda *desfazer* para apagar.',
    )
  })

  it('salvo: ontem, dd/mm, entrada e sem categoria', () => {
    expect(savedReply({ ...base, date: '2026-10-22' }, '2026-10-23')).toContain('· ontem ·')
    expect(savedReply({ ...base, date: '2026-10-10' }, '2026-10-23')).toContain('· 10/10 ·')
    const entrada = savedReply({ ...base, amountCents: 100000, category: null }, '2026-10-23')
    expect(entrada).toBe(
      '✅ Almoço · R$ 1.000,00 · crédito · Conta Corrente Nubank · hoje\nResponda *desfazer* para apagar.',
    )
  })

  it('renomeado', () => {
    expect(renamedReply({ ...base, date: '2026-10-22' }, '2026-10-30')).toBe(
      '✅ Essa já tinha chegado do banco: agora se chama Almoço · R$ 45,00 · Conta Corrente Nubank · 22/10\nResponda *desfazer* para voltar o nome.',
    )
  })

  it('pergunta', () => {
    const draft = { description: 'Almoço', amountCents: -4500, date: '2026-10-23', category: null }
    expect(
      askAccountReply(draft, [
        { accountId: 'a', label: 'Conta Corrente Nubank' },
        { accountId: 'b', label: 'Conta Corrente Itaú' },
        { accountId: 'w', label: 'Dinheiro (Carteira)' },
      ]),
    ).toBe(
      'Almoço · R$ 45,00 — de qual conta?\n1) Conta Corrente Nubank\n2) Conta Corrente Itaú\n3) Dinheiro (Carteira)',
    )
  })

  it('desfazer', () => {
    expect(undoReply({ kind: 'deleted' })).toBe('🗑️ Apagado.')
    expect(undoReply({ kind: 'restored' })).toBe('↩️ Voltei o nome que veio do banco.')
    expect(undoReply({ kind: 'nothing' })).toBe('Não achei nada recente para desfazer.')
  })
})
