import { describe, expect, it } from 'vitest'

import { closestDeposit, reconciliationWindow } from './reconciliation'

describe('reconciliationWindow', () => {
  it('MONTHLY mira o 5º dia útil do mês seguinte e vai até o dia 15', () => {
    expect(reconciliationWindow('2026-10', 'MONTHLY')).toEqual({
      from: '2026-10-01',
      to: '2026-11-15',
      target: '2026-11-09',
    })
  })

  it('ADVANCE mira o dia 20 da competência', () => {
    expect(reconciliationWindow('2026-10', 'ADVANCE').target).toBe('2026-10-20')
  })

  it('dezembro vira o ano', () => {
    expect(reconciliationWindow('2026-12', 'THIRTEENTH')).toMatchObject({
      from: '2026-12-01',
      to: '2027-01-15',
    })
  })
})

describe('closestDeposit', () => {
  it('escolhe a data mais próxima do alvo', () => {
    const tx = (id: string, date: string) => ({ id, date })
    expect(
      closestDeposit([tx('a', '2026-10-30'), tx('b', '2026-11-10'), tx('c', '2026-11-01')], '2026-11-09')?.id,
    ).toBe('b')
    expect(closestDeposit([], '2026-11-09')).toBeNull()
  })
})
