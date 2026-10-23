import { Nfc } from 'lucide-react'

import { BILL_STATUS_LABELS, type Bill, type CardAccount } from '@/http/cards'
import { formatBRL } from '@/lib/format'

/** Cores aproximadas dos cartões mais comuns, achadas pelo nome; o resto fica grafite. */
const BRANDS: { match: RegExp; gradient: string }[] = [
  { match: /nubank|nu\b/i, gradient: 'from-[#820ad1] to-[#4a0577]' },
  { match: /inter/i, gradient: 'from-[#ff7a00] to-[#c84f00]' },
  { match: /ita[uú]/i, gradient: 'from-[#ec7000] to-[#003399]' },
  { match: /c6/i, gradient: 'from-[#2b2b2b] to-[#0a0a0a]' },
  { match: /santander/i, gradient: 'from-[#ec0000] to-[#8f0000]' },
  { match: /bradesco/i, gradient: 'from-[#cc092f] to-[#7a0019]' },
  { match: /caixa/i, gradient: 'from-[#0070af] to-[#003f66]' },
  { match: /brasil|\bbb\b|ourocard/i, gradient: 'from-[#465eff] to-[#1c2a8c]' },
  { match: /picpay/i, gradient: 'from-[#21c25e] to-[#0f7a39]' },
  { match: /mercado ?pago/i, gradient: 'from-[#00b1ea] to-[#00669c]' },
]

const DEFAULT_GRADIENT = 'from-slate-700 to-slate-950'

function gradientFor(name: string) {
  return BRANDS.find((b) => b.match.test(name))?.gradient ?? DEFAULT_GRADIENT
}

/** Frente de um cartão físico: nome, final do número, fatura e ciclo. */
export function CreditCardFace({
  account,
  bill,
}: {
  account: CardAccount
  bill?: Bill
}) {
  return (
    <div
      className={`relative flex aspect-[86/54] w-full flex-col justify-between overflow-hidden rounded-2xl bg-linear-to-br p-5 text-white shadow-lg ${gradientFor(account.name)}`}
    >
      {/* Brilho diagonal, como o reflexo de um cartão plástico. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1/2 -right-1/4 size-full rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative flex items-start justify-between gap-3">
        <span className="truncate text-lg font-semibold">{account.name}</span>
        <Nfc className="size-6 shrink-0 opacity-80" aria-hidden />
      </div>

      <div className="relative flex items-center gap-4">
        <span
          aria-hidden
          className="h-8 w-11 rounded-md bg-linear-to-br from-amber-200 to-amber-500 shadow-inner"
        />
        <span className="font-mono text-base tracking-widest tabular-nums">
          {`•••• ${account.number ?? '••••'}`}
        </span>
      </div>

      <div className="relative flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs uppercase opacity-75">
            {bill
              ? `Fatura ${BILL_STATUS_LABELS[bill.status].toLowerCase()}`
              : 'Sem fatura'}
          </span>
          <span className="text-xl font-semibold tabular-nums">
            {bill ? formatBRL(bill.amountCents) : '—'}
          </span>
        </div>
        <span className="text-right text-xs opacity-75">
          {`Fecha ${account.closingDay ?? '-'} · vence ${account.dueDay ?? '-'}`}
        </span>
      </div>
    </div>
  )
}
