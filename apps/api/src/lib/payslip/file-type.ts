export type PayslipFileType = 'pdf' | 'png'

export const PAYSLIP_CONTENT_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
} as const satisfies Record<PayslipFileType, string>

const SIGNATURES: [PayslipFileType, Buffer][] = [
  ['pdf', Buffer.from('%PDF-')],
  ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
]

/** O tipo vem dos bytes iniciais, nunca do nome nem do Content-Type que o cliente mandou. */
export function detectPayslipFileType(file: Buffer): PayslipFileType | null {
  const match = SIGNATURES.find(([, signature]) => file.subarray(0, signature.length).equals(signature))
  return match?.[0] ?? null
}
