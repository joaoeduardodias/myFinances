// Só os campos que o myFinances usa, conferidos na referência da API
// (docs.pluggy.ai). Datas vêm como ISO 8601 com hora, exceto
// `creditData.balanceDueDate`, que é `YYYY-MM-DD`.

export type PluggyItem = {
  id: string
  status: string
  connector: { name: string }
  consentExpiresAt?: string | null
  error?: { code: string; message: string } | null
}

export type PluggyAccount = {
  id: string
  type: 'BANK' | 'CREDIT'
  subtype: string
  name: string
  number?: string
  balance: number
  creditData?: { balanceDueDate?: string; creditLimit?: number } | null
  /** `transferNumber` é `banco/agência/conta`, com o código COMPE do banco. */
  bankData?: { transferNumber?: string | null } | null
}

export type PluggyTransaction = {
  id: string
  accountId: string
  date: string
  description: string
  amount: number
  /** DEBIT é saída e CREDIT é entrada, em qualquer tipo de conta. */
  type: 'CREDIT' | 'DEBIT'
  status: 'PENDING' | 'POSTED'
  category?: string | null
  creditCardMetadata?: {
    installmentNumber?: number
    totalInstallments?: number
  } | null
}

export type PluggyBill = {
  id: string
  dueDate: string
  totalAmount: number
  payments?: { amount: number }[]
}
