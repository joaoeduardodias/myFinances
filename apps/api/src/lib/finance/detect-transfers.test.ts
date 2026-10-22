import { describe, expect, it } from 'vitest'

import {
  detectTransferPairs,
  isBillPaymentDescription,
  isWithdrawalDescription,
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

  it('deixa de fora transferLocked e as já marcadas como transferência', () => {
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000, { transferLocked: true }),
        tx('b', 'bank-b', '2026-10-10', 50000),
      ]),
    ).toEqual([])
    expect(
      detectTransferPairs([
        tx('a', 'bank-a', '2026-10-10', -50000),
        tx('b', 'bank-b', '2026-10-10', 50000, { isTransfer: true }),
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

  it('reconhece saque', () => {
    expect(isWithdrawalDescription('SAQUE 24H BANCO24HORAS')).toBe(true)
    expect(isWithdrawalDescription('Saquetto pizzaria')).toBe(false)
  })
})
