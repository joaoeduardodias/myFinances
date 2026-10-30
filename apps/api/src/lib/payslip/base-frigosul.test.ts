import { describe, expect, it } from 'vitest'

import { baseFrigosulPayslipParsed } from '@/test/payslip-sample'

import { parseBaseFrigosul } from './base-frigosul'

const header = 'Cod. Tp Descrição Referência Valor Cod. Tp Descrição Referência Valor'
const totals = (net = '2.970,00') =>
  `Totais: Proventos: 6.270,24 Vantagens: 0,00 Descontos: 3.300,24 Líquido: ${net}`

/** As linhas como saem do PDF: as duas colunas na mesma linha. */
const sideBySide = [
  'Local: 4.0002.0017 BASE FRIGOSUL, INDUSTRIA, FABRICA',
  'Tipo: 1 Colaborador: 203214 - FULANO Admissão: 13/03/2020 Dep.IR: 01 Dep.SF: 01',
  header,
  '3 01 Salário 220,00 4.770,00 165 03 Arredondamento Anterior 0,43',
  '34 01 Horas Extras c/ 50% 23,52 764,83 250 03 Desc.Adto Salarial 1.765,00',
  '65 01 Repouso S/ Horas Extras 8,82 191,21 302 03 INSS 14,00 656,85',
  '163 01 Arredondamento 0,76 310 03 IRRF Adto Salarial 297,26',
  '336 01 Insalubridade SN2 220,00 383,60 398 03 Contrib. Confederativa 1,00 47,70',
  '430 01 Participação Lucros/Resul 159,84 658 03 Desct.Ref.Refeição/Refeit 33,00',
  '673 03 Adiantamento Excepcional 500,00',
  '300 04 FGTS 8,00 488,77',
  totals(),
  'Bases IRRF Proc: 4.047,38 FGTS Proc: 6.109,64 INSS Proc: 6.109,64 IPE Proc: 0,00',
]

describe('parseBaseFrigosul', () => {
  it('lê proventos, descontos, bruto e líquido; o FGTS fica de fora', () => {
    expect(parseBaseFrigosul(sideBySide)).toEqual(baseFrigosulPayslipParsed)
  })

  it('lê também com cada coluna em linhas separadas', () => {
    const rows = sideBySide.slice(3, 11)
    const split = rows.flatMap((line) => line.split(/ (?=\d+ 0\d )/))
    const lines = [header, ...split, totals()]

    expect(parseBaseFrigosul(lines)).toEqual(baseFrigosulPayslipParsed)
  })

  it('no código e no tipo, O e l lidos pelo OCR valem 0 e 1', () => {
    const lines = sideBySide.map((line) =>
      line
        .replace(/^65 01 /, '65 Ol ')
        .replace(/^163 01 /, '163 0I ')
        .replace(/ 302 03 /, ' 3O2 O3 '),
    )
    expect(parseBaseFrigosul(lines)).toEqual(baseFrigosulPayslipParsed)
  })

  it('líquido que não fecha com proventos − descontos não é reconhecido', () => {
    const lines = sideBySide.map((line) => (line.startsWith('Totais') ? totals('2.971,00') : line))
    expect(parseBaseFrigosul(lines)).toBeNull()
  })

  it('linha faltando (soma diferente do total) não é reconhecida', () => {
    const lines = sideBySide.filter((line) => !line.startsWith('673 '))
    expect(parseBaseFrigosul(lines)).toBeNull()
  })

  it('sem a linha de totais não é reconhecido', () => {
    expect(parseBaseFrigosul(sideBySide.filter((line) => !line.startsWith('Totais')))).toBeNull()
  })

  it('sem o cabeçalho das colunas não é reconhecido', () => {
    expect(parseBaseFrigosul(sideBySide.filter((line) => line !== header))).toBeNull()
  })

  it('texto de outro documento não é reconhecido', () => {
    expect(parseBaseFrigosul(['Extrato bancário', 'Saldo: 1.000,00'])).toBeNull()
    expect(parseBaseFrigosul([])).toBeNull()
  })
})
