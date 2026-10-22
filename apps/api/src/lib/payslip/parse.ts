export type ParsedPayslip = {
  competence: string
  grossCents: number
  netCents: number
  lines: {
    kind: 'EARNING' | 'DEDUCTION'
    description: string
    reference: string | null
    amountCents: number
  }[]
}

/**
 * Lê os valores de um holerite em PDF. Na v1 não há layout conhecido e a
 * resposta é sempre `null` (o usuário lança as linhas à mão). O leitor do
 * layout da empresa entra aqui quando houver um PDF de exemplo, junto da rota
 * `POST /payslips/:id/reprocess`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parsePayslip(pdf: Buffer): ParsedPayslip | null {
  return null
}
