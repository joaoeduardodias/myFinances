import { describe, expect, it } from 'vitest'

import { monthlyFlow } from './monthly-flow'
import type { ProjectionTx } from './projection'

const accounts = [
  { id: 'bank', type: 'BANK' as const },
  { id: 'wallet', type: 'WALLET' as const },
  { id: 'card', type: 'CREDIT' as const },
]

function tx(extra: Partial<ProjectionTx>): ProjectionTx {
  return { accountId: 'bank', date: '2026-10-10', amountCents: 0, descriptionKey: 'x', isTransfer: false, ...extra }
}

describe('monthlyFlow', () => {
  it('devolve os 12 meses até o de hoje, atravessando o ano, mesmo sem lançamentos', () => {
    const flow = monthlyFlow({ today: '2026-02-15', accounts, transactions: [] })
    expect(flow.map((m) => m.month)).toEqual([
      '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08',
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
    expect(flow[0]).toEqual({ month: '2025-03', creditCents: 0, debitCents: 0, cardCents: 0 })
  })

  it('separa entradas, saídas das contas e compras no cartão; transferência e estorno ficam fora', () => {
    const flow = monthlyFlow({
      today: '2026-10-25',
      accounts,
      transactions: [
        tx({ amountCents: 500000 }),
        tx({ amountCents: -12000 }),
        tx({ accountId: 'wallet', amountCents: -3000 }),
        tx({ accountId: 'card', amountCents: -8000 }),
        tx({ accountId: 'card', amountCents: 2000 }),
        tx({ amountCents: -80000, isTransfer: true }),
        tx({ date: '2026-09-30', amountCents: -1000 }),
      ],
    })
    expect(flow.at(-1)).toEqual({ month: '2026-10', creditCents: 500000, debitCents: 15000, cardCents: 8000 })
    expect(flow.at(-2)).toMatchObject({ month: '2026-09', debitCents: 1000 })
  })

  it('ignora parcela futura e lançamento anterior à janela', () => {
    const flow = monthlyFlow({
      today: '2026-10-25',
      accounts,
      transactions: [
        tx({ accountId: 'card', date: '2026-10-26', amountCents: -5000 }),
        tx({ date: '2025-10-31', amountCents: -5000 }),
      ],
    })
    expect(flow.every((m) => m.cardCents === 0 && m.debitCents === 0)).toBe(true)
  })
})
