import { describe, expect, it } from 'vitest'

import {
  adjustToBusinessDay,
  bankHolidays,
  isBusinessDay,
  nthBusinessDay,
} from './business-days'

describe('bankHolidays', () => {
  it('inclui os feriados móveis pela Páscoa', () => {
    const holidays = bankHolidays(2026)
    expect(holidays.has('2026-02-16')).toBe(true) // segunda de Carnaval
    expect(holidays.has('2026-02-17')).toBe(true) // terça de Carnaval
    expect(holidays.has('2026-04-03')).toBe(true) // Sexta-feira Santa
    expect(holidays.has('2026-06-04')).toBe(true) // Corpus Christi
  })

  it('inclui os feriados nacionais fixos', () => {
    const holidays = bankHolidays(2026)
    for (const day of ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25']) {
      expect(holidays.has(`2026-${day}`)).toBe(true)
    }
  })
})

describe('isBusinessDay', () => {
  it('exclui fins de semana e feriados', () => {
    expect(isBusinessDay('2026-11-01')).toBe(false) // domingo
    expect(isBusinessDay('2026-11-07')).toBe(false) // sábado
    expect(isBusinessDay('2026-11-02')).toBe(false) // feriado
    expect(isBusinessDay('2026-11-03')).toBe(true)
  })
})

describe('nthBusinessDay', () => {
  it('pula feriados', () => {
    expect(nthBusinessDay(2026, 11, 5)).toBe('2026-11-09')
    expect(nthBusinessDay(2026, 9, 5)).toBe('2026-09-08')
  })

  it('aceita o último dia útil do mês', () => {
    // Outubro de 2026 tem 21 dias úteis (12/10 é feriado).
    expect(nthBusinessDay(2026, 10, 21)).toBe('2026-10-30')
  })

  it('recusa n fora dos dias úteis do mês em vez de girar para sempre', () => {
    expect(() => nthBusinessDay(2026, 10, 0)).toThrow(RangeError)
    expect(() => nthBusinessDay(2026, 10, 22)).toThrow(RangeError)
    expect(() => nthBusinessDay(2026, 10, 1.5)).toThrow(RangeError)
  })
})

describe('adjustToBusinessDay', () => {
  it('aplica a política em dia não útil', () => {
    expect(adjustToBusinessDay('2026-12-20', 'ANTICIPATE')).toBe('2026-12-18')
    expect(adjustToBusinessDay('2026-12-20', 'POSTPONE')).toBe('2026-12-21')
    expect(adjustToBusinessDay('2026-12-20', 'KEEP')).toBe('2026-12-20')
  })

  it('não mexe em dia útil', () => {
    expect(adjustToBusinessDay('2026-12-18', 'POSTPONE')).toBe('2026-12-18')
  })
})
