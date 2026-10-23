import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'

import { PayslipStatusBadge } from '@/components/payslip-status-badge'
import { PayslipUploadDialog } from '@/components/payslip-upload-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  listPayslips,
  PAYSLIP_TYPE_LABELS,
  type Payslip,
} from '@/http/payslips'
import { formatBRL } from '@/lib/format'
import { formatCompetence } from '@/lib/payslip'

function NetChart({ payslips }: { payslips: Payslip[] }) {
  const data = payslips
    .filter((p) => p.type === 'MONTHLY' && p.netCents !== null)
    .sort((a, b) => a.competence.localeCompare(b.competence))
    .slice(-12)
    .map((p) => ({
      label: formatCompetence(p.competence),
      net: p.netCents as number,
    }))
  if (data.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">Líquido mensal</h2>
      <div
        role="img"
        aria-label={`Gráfico do líquido mensal: ${data
          .map((d) => `${d.label} ${formatBRL(d.net)}`)
          .join(', ')}`}
        className="h-40 rounded-lg border p-2"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 600, height: 150 }}
        >
          <BarChart data={data}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
              formatter={(value) => [formatBRL(Number(value)), 'Líquido']}
              contentStyle={{
                background: 'var(--popover)',
                color: 'var(--popover-foreground)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
            />
            <Bar
              dataKey="net"
              fill="var(--chart-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export function Payslips() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['payslips'],
    queryFn: listPayslips,
  })

  const sorted = data
    ? [...data].sort((a, b) => b.competence.localeCompare(a.competence))
    : []

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Holerites</h1>
        <PayslipUploadDialog />
      </div>

      {isPending && <Skeleton className="h-32" aria-busy="true" />}
      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">Não foi possível carregar os holerites.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}

      {data && (
        <>
          <NetChart payslips={data} />
          {sorted.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum holerite enviado ainda.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {sorted.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/holerites/${p.id}`}
                    className="hover:bg-muted/50 flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5 text-sm">
                      <span className="font-medium">
                        {formatCompetence(p.competence)}
                      </span>
                      <span className="text-muted-foreground">
                        {PAYSLIP_TYPE_LABELS[p.type]}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <PayslipStatusBadge status={p.status} />
                      <span className="text-sm">
                        {p.netCents === null ? '—' : formatBRL(p.netCents)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
