import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { Analysis } from '@/http/analysis'
import { formatBRL } from '@/lib/format'
import { formatCompetence } from '@/lib/payslip'

export const GROUP_META = {
  essential: { label: 'Essencial', color: 'var(--essential)' },
  avoidable: { label: 'Evitável', color: 'var(--avoidable)' },
  debt: { label: 'Dívida', color: 'var(--debt)' },
  unclassified: { label: 'Sem classificação', color: 'var(--unclassified)' },
} as const

const SPEND_BARS = [
  { key: 'essentialCents', ...GROUP_META.essential },
  { key: 'avoidableCents', ...GROUP_META.avoidable },
  { key: 'debtCents', ...GROUP_META.debt },
  { key: 'unclassifiedCents', ...GROUP_META.unclassified },
] as const

const compactBRL = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Entradas numa barra e saídas empilhadas em outra, por mês; clicar numa barra escolhe o mês. */
export function AnalysisChart({
  months,
  onSelectMonth,
}: {
  months: Analysis['months']
  onSelectMonth: (month: string) => void
}) {
  const data = months.map((m) => ({ ...m, label: formatCompetence(m.month) }))

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Entradas e saídas por mês</CardTitle>
        <CardDescription>
          Clique numa barra para ver só aquele mês
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label={`Gráfico de entradas e saídas: ${data
            .map(
              (d) =>
                `${d.label} entrou ${formatBRL(d.incomeCents)}, saiu ${formatBRL(
                  d.essentialCents +
                    d.avoidableCents +
                    d.debtCents +
                    d.unclassifiedCents,
                )}`,
            )
            .join('; ')}`}
          className="h-80 xl:h-96"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 900, height: 360 }}
          >
            <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              />
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickFormatter={(v) => compactBRL.format(Number(v) / 100)}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                formatter={(value, name) => [formatBRL(Number(value)), name]}
                contentStyle={{
                  background: 'var(--popover)',
                  color: 'var(--popover-foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="incomeCents"
                name="Entrou"
                fill="var(--income)"
                cursor="pointer"
                onClick={(d) => onSelectMonth(d.month)}
                radius={[4, 4, 0, 0]}
              />
              {SPEND_BARS.map(({ key, label, color }) => (
                <Bar
                  key={key}
                  dataKey={key}
                  name={label}
                  stackId="spend"
                  fill={color}
                  cursor="pointer"
                  onClick={(d) => onSelectMonth(d.month)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
