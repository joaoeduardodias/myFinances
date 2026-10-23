import { describe, expect, it } from 'vitest'

import { type OverviewAccount, accountsOverview } from './accounts-overview'

function account(extra: Partial<OverviewAccount>): OverviewAccount {
  return {
    id: 'acc',
    type: 'BANK',
    name: 'Conta',
    number: null,
    balanceCents: 0,
    creditLimitCents: null,
    connectionId: 'conn',
    institutionCode: null,
    ...extra,
  }
}

describe('accountsOverview', () => {
  it('agrupa as contas pelo banco, do maior saldo para o menor, com nome e logo conhecidos', () => {
    const { banks } = accountsOverview([
      account({ id: 'cx1', balanceCents: 11899, connectionId: 'c1', institutionCode: '104' }),
      account({ id: 'cx2', balanceCents: 606, connectionId: 'c1', institutionCode: '104' }),
      account({ id: 'bd', balanceCents: 55823, connectionId: 'c2', institutionCode: '237' }),
    ])

    expect(banks.totalCents).toBe(68328)
    expect(banks.groups.map((g) => [g.name, g.balanceCents, g.accounts.length])).toEqual([
      ['Bradesco', 55823, 1],
      ['Caixa Econômica Federal', 12505, 2],
    ])
    expect(banks.groups[0].logoUrl).toBe('https://cdn.pluggy.ai/assets/connector-icons/203.svg')
  })

  it('banco desconhecido fica por conexão, com o nome da primeira conta e sem logo', () => {
    const { banks } = accountsOverview([
      account({ id: 'a', name: 'Banco Inter', connectionId: 'c1', institutionCode: '077' }),
      account({ id: 'b', name: 'Outro', connectionId: 'c2' }),
    ])

    expect(banks.groups.map((g) => [g.key, g.name, g.logoUrl])).toEqual([
      ['077', 'Banco Inter', null],
      ['c2', 'Outro', null],
    ])
  })

  it('a Carteira entra no total como grupo próprio, sempre por último', () => {
    const { banks } = accountsOverview([
      account({ id: 'bk', balanceCents: 5000, institutionCode: '260' }),
      account({ id: 'w', type: 'WALLET', name: 'Carteira', balanceCents: 10000, connectionId: null }),
    ])

    expect(banks.totalCents).toBe(15000)
    expect(banks.groups.at(-1)).toMatchObject({ key: 'wallet', kind: 'WALLET', name: 'Carteira' })
  })

  it('cartões: total devido e limite só dos que têm limite', () => {
    const { cards, banks } = accountsOverview([
      account({ id: 'k1', type: 'CREDIT', name: 'ELO MAIS', number: '0964', balanceCents: 65166, creditLimitCents: 80000 }),
      account({ id: 'k2', type: 'CREDIT', name: 'gold', balanceCents: 0, creditLimitCents: 4707 }),
      account({ id: 'k3', type: 'CREDIT', name: 'Sem limite', balanceCents: 1000 }),
    ])

    expect(banks.groups).toEqual([])
    expect(cards).toMatchObject({ totalCents: 66166, limitCents: 84707, limitUsedCents: 65166 })
    expect(cards.items.map((c) => c.name)).toEqual(['ELO MAIS', 'gold', 'Sem limite'])
  })

  it('sem cartão com limite, limitCents é nulo', () => {
    const { cards } = accountsOverview([account({ type: 'CREDIT', balanceCents: 100 })])
    expect(cards.limitCents).toBeNull()
  })
})
