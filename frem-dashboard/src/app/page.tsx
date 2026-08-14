import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Stat, Bar, Empty } from '@/components/stat'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  woodpecker_email: 'Email (Woodpecker)',
  faire_campaign: 'Faire campaigns',
  manual_email: 'Manual follow-ups',
  linkedin: 'LinkedIn',
}

type Perf = {
  channel: string
  sent: number | null
  replies: number | null
  reply_rate_pct: number | null
  closed: number | null
  revenue: number | null
}

type Migration = {
  month: string
  total_revenue: number | null
  direct_revenue: number | null
  revenue_migration_pct: number | null
  total_buyers: number | null
  direct_buyers: number | null
  buyer_migration_pct: number | null
  commission_paid: number | null
}

const money = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

const compact = (n: number) => n.toLocaleString('en-US')

export default async function Dashboard() {
  const supabase = await createClient()

  const [perfRes, migRes, ordersRes] = await Promise.all([
    supabase.from('v_channel_performance').select('*'),
    supabase.from('v_migration_rate').select('*').limit(12),
    supabase
      .from('orders')
      .select('display_id, amount, placed_at, sales_channel, retailers(name)')
      .neq('state', 'cancelled')
      .order('placed_at', { ascending: false })
      .limit(12),
  ])

  const perf = (perfRes.data ?? []) as Perf[]
  const migration = (migRes.data ?? []) as Migration[]
  // PostgREST types an embedded relation as an array even on a to-one FK.
  const orders = (ordersRes.data ?? []).map((o) => ({
    display_id: o.display_id as string | null,
    amount: Number(o.amount),
    placed_at: o.placed_at as string,
    sales_channel: o.sales_channel as string,
    retailerName:
      (Array.isArray(o.retailers) ? o.retailers[0]?.name : undefined) ?? null,
  }))

  const revenue = perf.reduce((s, r) => s + Number(r.revenue ?? 0), 0)
  const closed = perf.reduce((s, r) => s + Number(r.closed ?? 0), 0)
  const sent = perf.reduce((s, r) => s + Number(r.sent ?? 0), 0)
  const commission = migration.reduce(
    (s, m) => s + Number(m.commission_paid ?? 0),
    0
  )
  const latest = migration[0]

  const byRevenue = [...perf].sort(
    (a, b) => Number(b.revenue ?? 0) - Number(a.revenue ?? 0)
  )
  const maxRevenue = Math.max(...byRevenue.map((r) => Number(r.revenue ?? 0)), 0)

  const byRate = [...perf]
    .filter((r) => r.reply_rate_pct !== null)
    .sort((a, b) => Number(b.reply_rate_pct) - Number(a.reply_rate_pct))
  const maxRate = Math.max(...byRate.map((r) => Number(r.reply_rate_pct)), 0)

  const hasData = revenue > 0 || sent > 0

  return (
    <main className="mx-auto max-w-5xl space-y-14 p-8">
      <header className="flex items-end justify-between border-b border-border pb-5">
        <div className="space-y-1">
          <p className="wordmark text-sm text-muted">Frém</p>
          <h1 className="text-3xl">Moral Compass</h1>
        </div>
        <Link
          href="/linkedin"
          className="text-xs uppercase tracking-wider underline underline-offset-4"
        >
          LinkedIn entry →
        </Link>
      </header>

      {!hasData && (
        <Empty>
          No data yet. Run the Faire sync to pull orders, or add a day on the{' '}
          <Link href="/linkedin" className="underline underline-offset-2">
            LinkedIn page
          </Link>
          . Every figure below is computed from the database — nothing is
          hard-coded, so this stays empty until real data lands.
        </Empty>
      )}

      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Revenue" value={money(revenue)} note="attributed, ex-cancelled" />
        <Stat label="Closed" value={compact(closed)} note="orders won" />
        <Stat
          label="Commission to Faire"
          value={money(commission)}
          note="recoverable if direct"
        />
        <Stat
          label="Buyers migrated"
          value={
            latest?.buyer_migration_pct != null
              ? `${latest.buyer_migration_pct}%`
              : '—'
          }
          note={latest ? `month of ${latest.month}` : 'no orders yet'}
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Revenue by channel
          </h2>
          <span className="text-xs text-muted">
            {compact(sent)} touches sent in total
          </span>
        </div>

        {byRevenue.length === 0 ? (
          <Empty>No channel data.</Empty>
        ) : (
          <div>
            {byRevenue.map((r) => (
              <Bar
                key={r.channel}
                label={CHANNEL_LABEL[r.channel] ?? r.channel}
                value={Number(r.revenue ?? 0)}
                max={maxRevenue}
                display={money(Number(r.revenue ?? 0))}
                sub={`${compact(Number(r.closed ?? 0))} won`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Reply rate by channel
          </h2>
          {/* The whole point of this dashboard, stated plainly. */}
          <span className="text-xs text-muted">
            volume and conversion run opposite
          </span>
        </div>

        {byRate.length === 0 ? (
          <Empty>No reply data.</Empty>
        ) : (
          <div>
            {byRate.map((r) => (
              <Bar
                key={r.channel}
                label={CHANNEL_LABEL[r.channel] ?? r.channel}
                value={Number(r.reply_rate_pct)}
                max={maxRate}
                display={`${Number(r.reply_rate_pct).toFixed(2)}%`}
                sub={`of ${compact(Number(r.sent ?? 0))}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-muted">
          Migration off Faire — by month
        </h2>

        {migration.length === 0 ? (
          <Empty>
            Needs synced orders. Revenue share moves before buyer share; buyer
            share is the one that actually reduces platform dependency.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 font-normal">Month</th>
                  <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                  <th className="py-2 pr-4 text-right font-normal">Direct</th>
                  <th className="py-2 pr-4 text-right font-normal">Rev %</th>
                  <th className="py-2 pr-4 text-right font-normal">Buyers</th>
                  <th className="py-2 pr-4 text-right font-normal">Buyer %</th>
                  <th className="py-2 text-right font-normal">Commission</th>
                </tr>
              </thead>
              <tbody>
                {migration.map((m) => (
                  <tr key={m.month} className="border-b border-border">
                    <td className="numeric py-2 pr-4">{m.month}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money(Number(m.total_revenue ?? 0))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money(Number(m.direct_revenue ?? 0))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {m.revenue_migration_pct ?? '—'}%
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {m.total_buyers ?? 0}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {m.buyer_migration_pct ?? '—'}%
                    </td>
                    <td className="numeric py-2 text-right">
                      {money(Number(m.commission_paid ?? 0))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-muted">
          Recent orders
        </h2>

        {orders.length === 0 ? (
          <Empty>No orders synced yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 font-normal">Retailer</th>
                  <th className="py-2 pr-4 font-normal">Order</th>
                  <th className="py-2 pr-4 font-normal">Channel</th>
                  <th className="py-2 pr-4 font-normal">Placed</th>
                  <th className="py-2 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.display_id} className="border-b border-border">
                    <td className="py-2 pr-4">{o.retailerName ?? '—'}</td>
                    <td className="numeric py-2 pr-4 text-muted">
                      {o.display_id}
                    </td>
                    <td className="py-2 pr-4">
                      {o.sales_channel === 'faire_marketplace'
                        ? 'Faire marketplace'
                        : o.sales_channel === 'faire_direct'
                          ? 'Faire Direct'
                          : 'Shopify'}
                    </td>
                    <td className="numeric py-2 pr-4 text-muted">
                      {o.placed_at.slice(0, 10)}
                    </td>
                    <td className="numeric py-2 text-right">
                      {money(Number(o.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
