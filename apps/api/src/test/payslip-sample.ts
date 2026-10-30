import { buildTextPdf, type PdfText } from './pdf'

type SampleRow = [code: string, tp: string, description: string, reference: string | null, value: string]

const earnings: SampleRow[] = [
  ['3', '01', 'Salário', '220,00', '4.770,00'],
  ['34', '01', 'Horas Extras c/ 50%', '23,52', '764,83'],
  ['65', '01', 'Repouso S/ Horas Extras', '8,82', '191,21'],
  ['163', '01', 'Arredondamento', null, '0,76'],
  ['336', '01', 'Insalubridade SN2', '220,00', '383,60'],
  ['430', '01', 'Participação Lucros/Resul', null, '159,84'],
]

const deductions: SampleRow[] = [
  ['165', '03', 'Arredondamento Anterior', null, '0,43'],
  ['250', '03', 'Desc.Adto Salarial', null, '1.765,00'],
  ['302', '03', 'INSS', '14,00', '656,85'],
  ['310', '03', 'IRRF Adto Salarial', null, '297,26'],
  ['398', '03', 'Contrib. Confederativa', '1,00', '47,70'],
  ['658', '03', 'Desct.Ref.Refeição/Refeit', null, '33,00'],
  ['673', '03', 'Adiantamento Excepcional', null, '500,00'],
  ['300', '04', 'FGTS', '8,00', '488,77'],
]

function rowTexts([code, tp, description, reference, value]: SampleRow, y: number, left: number): PdfText[] {
  return [
    { x: left, y, text: code },
    { x: left + 25, y, text: tp },
    { x: left + 50, y, text: description },
    ...(reference ? [{ x: left + 230, y, text: reference }] : []),
    { x: left + 310, y, text: value },
  ]
}

/**
 * O holerite mensal da Base Frigosul (`holerite.png`) com dados fictícios, como
 * textos posicionados numa página A4 deitada, com as duas colunas lado a lado.
 * `net` troca o líquido para testar totais que não fecham.
 */
export function baseFrigosulPayslipTexts({ net = '2.970,00' }: { net?: string } = {}): PdfText[] {
  const top = 500
  const rows = Array.from({ length: Math.max(earnings.length, deductions.length) }, (_, i) => {
    const y = top - 12 * (i + 1)
    return [
      ...(earnings[i] ? rowTexts(earnings[i], y, 20) : []),
      ...(deductions[i] ? rowTexts(deductions[i], y, 420) : []),
    ]
  }).flat()
  const totalsY = top - 12 * (deductions.length + 2)

  return [
    { x: 20, y: 560, text: 'Local: 4.0002.0017 BASE FRIGOSUL, INDUSTRIA, FABRICA' },
    { x: 20, y: 545, text: 'Tipo: 1 Colaborador: 203214 - FULANO DE TAL' },
    { x: 420, y: 545, text: 'Admissão: 13/03/2020 Dep.IR: 01 Dep.SF: 01 Sit: Trabalhando' },
    { x: 420, y: 533, text: 'Salário Base: 4.770,00 Estr.: 0000 Classe: Nível:' },
    ...['Cod.', 'Tp', 'Descrição', 'Referência', 'Valor'].flatMap((text, i) => [
      { x: [20, 45, 70, 250, 330][i], y: top, text },
      { x: [420, 445, 470, 650, 730][i], y: top, text },
    ]),
    ...rows,
    { x: 20, y: totalsY, text: 'Totais:' },
    { x: 80, y: totalsY, text: 'Proventos:' },
    { x: 150, y: totalsY, text: '6.270,24' },
    { x: 280, y: totalsY, text: 'Vantagens:' },
    { x: 350, y: totalsY, text: '0,00' },
    { x: 560, y: totalsY, text: 'Descontos:' },
    { x: 640, y: totalsY, text: '3.300,24' },
    { x: 700, y: totalsY, text: 'Líquido:' },
    { x: 760, y: totalsY, text: net },
    { x: 80, y: totalsY - 12, text: 'Bases IRRF Proc: 4.047,38 FGTS Proc: 6.109,64 INSS Proc: 6.109,64' },
  ]
}

export function baseFrigosulPayslipPdf(options: { net?: string } = {}) {
  return buildTextPdf(baseFrigosulPayslipTexts(options))
}

/**
 * O mesmo holerite como PNG, imitando o print original: 1088 px de largura,
 * letra de 11 px e números alinhados à direita. O arquivo
 * `fixtures/base-frigosul-payslip.png` é gerado uma vez (as fontes mudam de
 * máquina para máquina) com `sharp(Buffer.from(baseFrigosulPayslipSvg())).png()`.
 */
export function baseFrigosulPayslipSvg() {
  const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const text = (x: number, y: number, value: string, anchor: 'start' | 'end' = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}">${escapeXml(value)}</text>`
  const columns = (left: number) => ({ code: left + 22, tp: left + 34, description: left + 62, reference: left + 335, value: left + 440 })
  const row = ([code, tp, description, reference, value]: SampleRow, y: number, left: number) => {
    const c = columns(left)
    return [
      text(c.code, y, code, 'end'),
      text(c.tp, y, tp),
      text(c.description, y, description),
      reference ? text(c.reference, y, reference, 'end') : '',
      text(c.value, y, value, 'end'),
    ].join('')
  }
  const header = (left: number) => {
    const c = columns(left)
    return [
      text(c.code - 22, 82, 'Cod.'),
      text(c.tp, 82, 'Tp'),
      text(c.description, 82, 'Descrição'),
      text(c.reference - 60, 82, 'Referência'),
      text(c.value - 50, 82, 'Valor'),
    ].join('')
  }
  const rows = Array.from({ length: deductions.length }, (_, i) => {
    const y = 102 + 14.5 * i
    return (earnings[i] ? row(earnings[i], y, 0) : '') + row(deductions[i], y, 520)
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1088" height="256"><rect width="100%" height="100%" fill="white"/><g font-family="Liberation Sans, Arial, sans-serif" font-size="11" fill="black">${[
    text(5, 13, 'Local: 4.0002.0017 BASE FRIGOSUL, INDUSTRIA, FABRICA'),
    text(5, 33, 'Tipo: 1 Colaborador: 203214 - FULANO DE TAL'),
    text(480, 33, 'Admissão: 13/03/2020 Dep.IR: 01 Dep.SF: 01 Sit: Trabalhando'),
    text(480, 49, 'Salário Base: 4.770,00 Estr.: 0000 Classe: Nível:'),
    header(0),
    header(520),
    rows,
    text(5, 230, 'Totais:'),
    text(90, 230, 'Proventos:'),
    text(260, 230, '6.270,24', 'end'),
    text(360, 230, 'Vantagens:'),
    text(500, 230, '0,00', 'end'),
    text(640, 230, 'Descontos:'),
    text(790, 230, '3.300,24', 'end'),
    text(880, 230, 'Líquido:'),
    text(1050, 230, '2.970,00', 'end'),
    text(75, 248, 'Bases IRRF Proc: 4.047,38 FGTS Proc: 6.109,64 INSS Proc: 6.109,64'),
  ].join('')}</g></svg>`
}

/** O que o leitor deve devolver para `baseFrigosulPayslipPdf()`. */
export const baseFrigosulPayslipParsed = {
  grossCents: 627024,
  netCents: 297000,
  lines: [
    { kind: 'EARNING', description: 'Salário', reference: '220,00', amountCents: 477000 },
    { kind: 'EARNING', description: 'Horas Extras c/ 50%', reference: '23,52', amountCents: 76483 },
    { kind: 'EARNING', description: 'Repouso S/ Horas Extras', reference: '8,82', amountCents: 19121 },
    { kind: 'EARNING', description: 'Arredondamento', reference: null, amountCents: 76 },
    { kind: 'EARNING', description: 'Insalubridade SN2', reference: '220,00', amountCents: 38360 },
    { kind: 'EARNING', description: 'Participação Lucros/Resul', reference: null, amountCents: 15984 },
    { kind: 'DEDUCTION', description: 'Arredondamento Anterior', reference: null, amountCents: 43 },
    { kind: 'DEDUCTION', description: 'Desc.Adto Salarial', reference: null, amountCents: 176500 },
    { kind: 'DEDUCTION', description: 'INSS', reference: '14,00', amountCents: 65685 },
    { kind: 'DEDUCTION', description: 'IRRF Adto Salarial', reference: null, amountCents: 29726 },
    { kind: 'DEDUCTION', description: 'Contrib. Confederativa', reference: '1,00', amountCents: 4770 },
    { kind: 'DEDUCTION', description: 'Desct.Ref.Refeição/Refeit', reference: null, amountCents: 3300 },
    { kind: 'DEDUCTION', description: 'Adiantamento Excepcional', reference: null, amountCents: 50000 },
  ],
} as const
