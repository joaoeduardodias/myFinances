import { Badge } from '@/components/ui/badge'
import type { PayslipStatus } from '@/http/payslips'

const STATUS: Record<
  PayslipStatus,
  { label: string; variant: 'outline' | 'secondary' | 'default' }
> = {
  UNRECOGNIZED: { label: 'Não reconhecido', variant: 'outline' },
  RECOGNIZED: { label: 'Reconhecido', variant: 'default' },
  MANUAL: { label: 'Manual', variant: 'secondary' },
}

export function PayslipStatusBadge({ status }: { status: PayslipStatus }) {
  const { label, variant } = STATUS[status]
  return <Badge variant={variant}>{label}</Badge>
}
