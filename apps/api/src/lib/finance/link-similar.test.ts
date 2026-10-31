import { describe, expect, it } from 'vitest'

import { similarTxIds } from './link-similar'

const tx = (id: string, date: string, extra: Partial<Parameters<typeof similarTxIds>[1][number]> = {}) => ({
  id,
  date,
  amountCents: -154602,
  descriptionKey: 'efetuado banco c s a',
  isTransfer: false,
  recurrenceId: null as string | null,
  ...extra,
})

describe('similarTxIds', () => {
  // O caso do financiamento do carro: mesmo texto no Nubank, boleto com outro texto na Caixa, mesmo valor.
  const linked = [tx('jul', '2026-07-06', { recurrenceId: 'car' })]

  it('acha as do mesmo texto do banco ou do mesmo valor exato, em qualquer conta', () => {
    const candidates = [
      tx('sep', '2026-09-08'),
      tx('oct', '2026-10-06', { descriptionKey: 'de boleto' }),
      tx('other', '2026-10-10', { descriptionKey: 'mercado', amountCents: -15000 }),
    ]
    expect(similarTxIds(linked, candidates, new Set())).toEqual(['sep', 'oct'])
  })

  it('uma por mês, e nenhuma no mês que já tem vinculada', () => {
    const candidates = [
      tx('jul-2', '2026-07-20'),
      tx('sep-a', '2026-09-08', { descriptionKey: 'de boleto' }),
      tx('sep-b', '2026-09-09'),
    ]
    // No mesmo mês, a que bate texto e valor ganha da que só bate o valor.
    expect(similarTxIds(linked, candidates, new Set())).toEqual(['sep-b'])
  })

  it('não pega transferência, sinal trocado, vinculada a outro recorrente nem o "não é"', () => {
    const candidates = [
      tx('transfer', '2026-08-06', { isTransfer: true }),
      tx('refund', '2026-09-06', { amountCents: 154602 }),
      tx('taken', '2026-10-06', { recurrenceId: 'other' }),
      tx('dismissed', '2026-11-06'),
    ]
    expect(similarTxIds(linked, candidates, new Set(['dismissed']))).toEqual([])
  })

  it('sem vinculada, nada', () => {
    expect(similarTxIds([], [tx('sep', '2026-09-08')], new Set())).toEqual([])
  })

  it('texto genérico de Pix não basta: com o mesmo texto, o valor tem de ficar a até 25% de uma vinculada', () => {
    const energy = [tx('oct', '2026-10-06', { descriptionKey: 'deb pix qr cod est', amountCents: -37320, recurrenceId: 'energy' })]
    const candidates = [
      tx('small-pix', '2026-09-23', { descriptionKey: 'deb pix qr cod est', amountCents: -7000 }),
      tx('aug-bill', '2026-08-06', { descriptionKey: 'deb pix qr cod est', amountCents: -30000 }),
    ]
    expect(similarTxIds(energy, candidates, new Set())).toEqual(['aug-bill'])
  })
})
