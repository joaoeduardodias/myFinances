import { describe, expect, it } from 'vitest'

import { expectedDates } from './recurrence-schedule'

describe('expectedDates', () => {
  it('limita o dia ao último do mês', () => {
    const rule = { dayRule: 'DAY_OF_MONTH', dayValue: 31, nonBusinessDayPolicy: 'KEEP' } as const
    expect(expectedDates(rule, '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('aplica a política ao dia do mês', () => {
    const rule = { dayRule: 'DAY_OF_MONTH', dayValue: 28, nonBusinessDayPolicy: 'ANTICIPATE' } as const
    expect(expectedDates(rule, '2026-02-01', '2026-02-28')).toEqual(['2026-02-27']) // 28/02/2026 é sábado
  })

  it('calcula o n-ésimo dia útil ignorando a política', () => {
    const salary = { dayRule: 'NTH_BUSINESS_DAY', dayValue: 5, nonBusinessDayPolicy: 'ANTICIPATE' } as const
    expect(expectedDates(salary, '2026-10-22', '2026-12-31')).toEqual(['2026-11-09', '2026-12-07'])
  })

  it('só devolve datas dentro de [from, to]', () => {
    const rule = { dayRule: 'DAY_OF_MONTH', dayValue: 10, nonBusinessDayPolicy: 'KEEP' } as const
    expect(expectedDates(rule, '2026-01-11', '2026-03-09')).toEqual(['2026-02-10'])
  })

  it('inclui a data do mês seguinte antecipada para dentro do intervalo', () => {
    const rent = { dayRule: 'DAY_OF_MONTH', dayValue: 1, nonBusinessDayPolicy: 'ANTICIPATE' } as const
    // 01/11/2026 é domingo
    expect(expectedDates(rent, '2026-10-01', '2026-10-31')).toEqual(['2026-10-01', '2026-10-30'])
  })

  it('inclui a data do mês anterior adiada para dentro do intervalo', () => {
    const rule = { dayRule: 'DAY_OF_MONTH', dayValue: 31, nonBusinessDayPolicy: 'POSTPONE' } as const
    // 31/05/2026 é domingo, vai para 01/06
    expect(expectedDates(rule, '2026-06-01', '2026-06-30')).toEqual(['2026-06-01', '2026-06-30'])
  })
})
