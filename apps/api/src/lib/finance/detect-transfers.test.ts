import { describe, expect, it } from 'vitest'

import {
  detectTransferPairs,
  isBillPaymentDescription,
  isCardPaymentCreditDescription,
  isWithdrawalDescription,
  pickTransferCounterpart,
  type TransferCandidate,
} from './detect-transfers'

function tx(
  id: string,
  accountId: string,
  date: string,
  amountCents: number,
  extra: Partial<TransferCandidate> = {},
): TransferCandidate {
  return {
    id,
    accountId,
    date,
    amountCents,
    accountType: accountId.startsWith('card') ? 'CREDIT' : accountId.startsWith('wallet') ? 'WALLET' : 'BANK',
    isTransfer: false,
    transferLocked: false,
    ...extra,
  }
}

describe('detectTransferPairs', () => {
  it('pareia saída e entrada de mesmo valor em contas diferentes a 1 dia', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('b', 'bank-b', '2026-10-11', 50000),
    ])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('não pareia com 4 dias de diferença', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('b', 'bank-b', '2026-10-14', 50000),
    ])
    expect(pairs).toEqual([])
  })

  it('pareia com 3 dias de diferença', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('b', 'bank-b', '2026-10-13', 50000),
    ])
    expect(pairs).toEqual([['a', 'b']])
  })

  it('não pareia na mesma conta nem com valores diferentes', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('b', 'bank-a', '2026-10-10', 50000),
      tx('c', 'bank-b', '2026-10-10', 50001),
    ])
    expect(pairs).toEqual([])
  })

  it('com duas candidatas, pareia a de data mais próxima', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('far', 'bank-b', '2026-10-12', 50000),
      tx('near', 'bank-c', '2026-10-11', 50000),
    ])
    expect(pairs).toEqual([['a', 'near']])
  })

  it('no empate de data, pareia a primeira pelo id', () => {
    const pairs = detectTransferPairs([
      tx('a', 'bank-a', '2026-10-10', -50000),
      tx('z', 'bank-b', '2026-10-11', 50000),
      tx('m', 'bank-c', '2026-10-09', 50000),
    ])
    expect(pairs).toEqual([['a', 'm']])
  })

  it('cada transação entra em no máximo um par', () => {
    const pairs = detectTransferPairs([
      tx('a1', 'bank-a', '2026-10-10', -50000),
      tx('a2', 'bank-a', '2026-10-10', -50000),
      tx('b', 'bank-b', '2026-10-10', 50000),
    ])
    expect(pairs).toEqual([['a1', 'b']])
  })

  it('deixa de fora transferLocked', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000, { transferLocked: true }),
        tx('b', 'bank-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
  })

  // Pagamento de fatura marcado sozinho numa sincronização ainda pareia
  // quando o outro lado chega depois.
  it('a já marcada como transferência, mas sem par e sem trava, ainda pareia', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000, { isTransfer: true }),
        tx('b', 'card-b', '2026-10-11', 50000),
      ]),
    ).toEqual([['a', 'b']])
  })

  // Já marcada sozinha só pode ser pagamento de fatura: não leva junto uma
  // entrada de mesmo valor em outra conta corrente.
  it('a já marcada como transferência só pareia com o cartão', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000, { isTransfer: true }),
        tx('b', 'bank-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
  })

  it('pareia saída do banco com entrada no cartão (pagamento de fatura)', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000),
        tx('b', 'card-b', '2026-10-10', 50000),
      ]),
    ).toEqual([['a', 'b']])
  })

  it('nunca pareia compra no cartão (saída em CREDIT)', () => {
    expect(
      detectTransferPairs([
        tx('a', 'card-a', '2026-10-10', -50000),
        tx('b', 'bank-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
    expect(
      detectTransferPairs([
        tx('a', 'card-a', '2026-10-10', -50000),
        tx('b', 'card-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
  })

  it('nunca pareia a Carteira, de nenhum lado', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000),
        tx('b', 'wallet-1', '2026-10-10', 50000),
      ]),
    ).toEqual([])
    expect(
      detectTransferPairs([
        tx('a', 'wallet-1', '2026-10-10', -50000),
        tx('b', 'bank-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
    expect(
      detectTransferPairs([
        tx('a', 'wallet-1', '2026-10-10', -50000),
        tx('b', 'card-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
  })
})

describe('descrições', () => {
  it('reconhece pagamento de fatura', () => {
    expect(isBillPaymentDescription('PAGTO FATURA NUBANK')).toBe(true)
    expect(isBillPaymentDescription('Pagamento de fatura')).toBe(true)
    expect(isBillPaymentDescription('PAG FATURA')).toBe(true)
    expect(isBillPaymentDescription('Pix enviado Fulano')).toBe(false)
  })

  it('no cartão, a entrada de pagamento também vale sem a palavra fatura', () => {
    expect(isCardPaymentCreditDescription('PAGAMENTO RECEBIDO')).toBe(true)
    expect(isCardPaymentCreditDescription('Pagto efetuado')).toBe(true)
    expect(isCardPaymentCreditDescription('Pagamento de fatura')).toBe(true)
    expect(isCardPaymentCreditDescription('Estorno compra')).toBe(false)
    expect(isCardPaymentCreditDescription('PAGUE MENOS')).toBe(false)
  })

  it('reconhece saque', () => {
    expect(isWithdrawalDescription('SAQUE 24H BANCO24HORAS')).toBe(true)
    expect(isWithdrawalDescription('Saquetto pizzaria')).toBe(false)
  })
})

describe('pickTransferCounterpart', () => {
  it('escolhe a perna de data mais próxima', () => {
    const picked = pickTransferCounterpart('2026-10-21', [
      { id: 'far', date: '2026-10-23' },
      { id: 'near', date: '2026-10-21' },
    ])
    expect(picked).toBe('near')
  })

  it('no empate de data fica o menor id', () => {
    const picked = pickTransferCounterpart('2026-10-21', [
      { id: 'b', date: '2026-10-20' },
      { id: 'a', date: '2026-10-22' },
    ])
    expect(picked).toBe('a')
  })

  it('ignora quem está a mais de 3 dias', () => {
    expect(pickTransferCounterpart('2026-10-21', [{ id: 'x', date: '2026-10-25' }])).toBeNull()
  })

  it('sem candidatas devolve null', () => {
    expect(pickTransferCounterpart('2026-10-21', [])).toBeNull()
  })
})
