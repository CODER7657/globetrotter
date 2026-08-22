import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Skeleton } from '../../components/primitives.js'
import { useCost } from '../../lib/trips.js'

/**
 * The whole budget panel from one call.
 *
 * `app.trip_cost_breakdown()` returns categories, the per-day series, the
 * cumulative curve and transfer warnings together. Nothing here sums, averages
 * or re-derives anything: money arrives as a JSON number and the contract is
 * explicit that client-side arithmetic can disagree with the database's exact
 * numeric. Every figure rendered below is one the server already computed.
 */

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

/** Wraps round the ramp. Never undefined, which `noUncheckedIndexedAccess` requires. */
function colorAt(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0]
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Recharts hands the formatter `ValueType | undefined`, so narrow rather than
 * assume a number — a tooltip on an empty slice would otherwise render "NaN".
 */
function moneyTooltip(currency: string) {
  return (value: unknown): string =>
    typeof value === 'number' ? money(value, currency) : String(value ?? '')
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-card-foreground">{value}</dd>
    </div>
  )
}

export function CostPanel({ tripId }: { readonly tripId: string }) {
  const { data, isPending, isError } = useCost(tripId)

  if (isPending) {
    return (
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </aside>
    )
  }

  if (isError || data === undefined) {
    return (
      <aside className="rounded-[var(--radius-lg)] border border-dashed border-border p-5 lg:sticky lg:top-4 lg:self-start">
        <p className="text-sm font-medium text-foreground">Live cost</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Unavailable — <code>GET /trips/:id/cost</code> ships in #70. The panel renders the
          moment it lands; nothing here is stubbed.
        </p>
      </aside>
    )
  }

  const categories = Object.entries(data.byCategory).map(([name, amount]) => ({ name, amount }))

  return (
    <aside aria-label="Live cost" className="space-y-4 lg:sticky lg:top-4 lg:self-start">
      <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <dl className="grid grid-cols-2 gap-4">
          <Stat label="Total" value={money(data.total, data.currency)} />
          <Stat
            label="Per day"
            value={data.perDayAverage === null ? '—' : money(data.perDayAverage, data.currency)}
          />
          <Stat label="Days" value={String(data.totalDays)} />
          <Stat
            label="Remaining"
            value={data.remaining === null ? 'No cap' : money(data.remaining, data.currency)}
          />
        </dl>

        {data.overBudget && (
          <p
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            Over budget by {money(Math.abs(data.remaining ?? 0), data.currency)}.
          </p>
        )}
      </section>

      {categories.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-medium text-card-foreground">By category</h3>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={categories} dataKey="amount" nameKey="name" innerRadius={38} outerRadius={62}>
                  {categories.map((entry, index) => (
                    <Cell key={entry.name} fill={colorAt(index)} />
                  ))}
                </Pie>
                <Tooltip formatter={moneyTooltip(data.currency)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/*
            Every chart carries a table fallback. A donut is unreadable to a
            screen reader and to anyone who cannot separate the hues.
          */}
          <table className="mt-3 w-full text-xs">
            <caption className="sr-only">Cost by category</caption>
            <tbody>
              {categories.map((entry) => (
                <tr key={entry.name}>
                  <th scope="row" className="py-0.5 text-left font-normal capitalize text-muted-foreground">
                    {entry.name}
                  </th>
                  <td className="py-0.5 text-right tabular-nums text-card-foreground">
                    {money(entry.amount, data.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.perDay.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-medium text-card-foreground">Spend per day</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[...data.perDay]}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" hide />
                <YAxis hide />
                <Tooltip formatter={moneyTooltip(data.currency)} />
                <Bar dataKey="amount" fill="var(--chart-1)" radius={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {data.cumulative.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-medium text-card-foreground">Cumulative</h3>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[...data.cumulative]}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="city" hide />
                <YAxis hide />
                <Tooltip formatter={moneyTooltip(data.currency)} />
                <Line
                  type="monotone"
                  dataKey="runningTotal"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {data.warnings.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-medium text-card-foreground">Feasibility</h3>
          <ul className="space-y-1.5">
            {data.warnings.map((warning) => (
              <li key={warning.seq} className="text-xs text-muted-foreground">
                Only {String(warning.gapMinutes)} min between {warning.from} and {warning.to}.
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
