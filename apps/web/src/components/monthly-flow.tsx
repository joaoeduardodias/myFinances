import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  type LucideIcon,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  Area,
  AreaChart,
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
import type { FlowMonth } from '@/http/dashboard'
import { formatBRL } from '@/lib/format'
import { formatCompetence } from '@/lib/payslip'

const SERIES = [
  {
    key: 'creditCents',
    label: 'Créditos',
    color: 'var(--income)',
    icon: ArrowDownLeft,
    tone: 'text-income',
    upIsGood: true,
  },
  {
    key: 'debitCents',
    label: 'Débitos',
    color: 'var(--destructive)',
    icon: ArrowUpRight,
    tone: 'text-destructive',
    upIsGood: false,
  },
  {
    key: 'cardCents',
    label: 'Compras no cartão',
    color: 'var(--chart-4)',
    icon: CreditCard,
    tone: '',
    upIsGood: false,
  },
] as const

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})

function resultOf(m: FlowMonth) {
  return m.creditCents - m.debitCents - m.cardCents
}

/** Variação contra o mês anterior; subir é bom ou ruim conforme o indicador. */
function Delta({
  current,
  previous,
  upIsGood,
}: {
  current: number
  previous: number
  upIsGood: boolean
}) {
  if (previous === 0 || current === previous) {
    return (
      <span className="text-muted-foreground">
        {`Mês anterior: ${formatBRL(previous)}`}
      </span>
    )
  }
  const ratio = (current - previous) / Math.abs(previous)
  const Icon = ratio > 0 ? TrendingUp : TrendingDown
  const good = ratio > 0 === upIsGood
  return (
    <span className="text-muted-foreground flex flex-wrap items-center gap-x-1.5">
      <span
        className={`inline-flex items-center gap-1 font-medium ${good ? 'text-income' : 'text-destructive'}`}
      >
        <Icon className="size-3.5" aria-hidden />
        {percent.format(ratio)}
      </span>
      {`vs mês anterior (${formatBRL(previous)})`}
    </span>
  )
}

function Kpi({
  label,
  icon: Icon,
  valueCents,
  tone,
  children,
}: {
  label: string
  icon: LucideIcon
  valueCents: number
  tone: string
  children?: React.ReactNode
}) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardDescription className="flex items-center justify-between gap-2 text-xs font-semibold tracking-wider uppercase">
          {label}
          <span className="bg-muted flex size-8 items-center justify-center rounded-lg">
            <Icon className="size-4" aria-hidden />
          </span>
        </CardDescription>
        <CardTitle className={`text-2xl font-semibold tabular-nums ${tone}`}>
          {formatBRL(valueCents)}
        </CardTitle>
      </CardHeader>
      {children && (
        <CardContent className="px-5 text-xs tabular-nums">
          {children}
        </CardContent>
      )}
    </Card>
  )
}

/** Indicadores do mês: créditos, débitos, compras no cartão e o resultado, contra o mês anterior. */
export function FlowSummary({ flow }: { flow: FlowMonth[] }) {
  const current = flow.at(-1)
  const previous = flow.at(-2)
  if (!current) return null
  const result = resultOf(current)

  return (
    <section
      aria-label="Movimento do mês"
      className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"
    >
      {SERIES.map(({ key, label, icon, tone, upIsGood }) => (
        <Kpi
          key={key}
          label={`${label} no mês`}
          icon={icon}
          valueCents={current[key]}
          tone={tone}
        >
          {previous && (
            <Delta
              current={current[key]}
              previous={previous[key]}
              upIsGood={upIsGood}
            />
          )}
        </Kpi>
      ))}
      <Kpi
        label="Resultado do mês"
        icon={Scale}
        valueCents={result}
        tone={result < 0 ? 'text-destructive' : 'text-income'}
      >
        <span className="text-muted-foreground">
          Créditos − débitos − cartão
        </span>
      </Kpi>
    </section>
  )
}

const compactBRL = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Evolução mensal dos créditos, débitos e compras no cartão nos últimos 12 meses. */
export function FlowChart({ flow }: { flow: FlowMonth[] }) {
  const data = flow.map((m) => ({ ...m, label: formatCompetence(m.month) }))
  const totals = SERIES.map(({ key, label, color }) => ({
    key,
    label,
    color,
    cents: flow.reduce((sum, m) => sum + m[key], 0),
  }))

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Evolução mensal</CardTitle>
        <CardDescription>Últimos 12 meses, sem transferências</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {totals.map(({ key, label, color, cents }) => (
            <div key={key} className="bg-muted/40 rounded-lg px-4 py-3">
              <dt className="text-muted-foreground flex items-center gap-2 text-xs">
                <span
                  className="size-2 rounded-full"
                  style={{ background: color }}
                  aria-hidden
                />
                {`${label} em 12 meses`}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {formatBRL(cents)}
              </dd>
            </div>
          ))}
        </dl>
        <div
          role="img"
          aria-label={`Gráfico da evolução mensal: ${data
            .map(
              (d) =>
                `${d.label} créditos ${formatBRL(d.creditCents)}, débitos ${formatBRL(
                  d.debitCents,
                )}, cartão ${formatBRL(d.cardCents)}`,
            )
            .join('; ')}`}
          className="h-80 xl:h-96"
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 900, height: 360 }}
          >
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              <defs>
                {SERIES.map(({ key, color }) => (
                  <linearGradient
                    key={key}
                    id={`flow-${key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
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
                cursor={{ stroke: 'var(--border)' }}
                formatter={(value, name) => [formatBRL(Number(value)), name]}
                contentStyle={{
                  background: 'var(--popover)',
                  color: 'var(--popover-foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.map(({ key, label, color }) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={label}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#flow-${key})`}
                  activeDot={{ r: 4 }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
