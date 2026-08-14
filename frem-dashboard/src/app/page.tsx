import Link from 'next/link'
import { createReadClient } from '@/lib/supabase/read'
import { Stat, Bar, Empty } from '@/components/stat'
import {
  RangeFilter,
  parseRange,
  rangeStart,
  RANGES,
} from '@/components/range-filter'

export const dynamic = 'force-dynamic'

const CHANNEL_LABEL: Record<string, string> = {
  woodpecker_email: 'Email (Woodpecker)',
  faire_campaign: 'Faire campaigns',
  manual_email: 'Manual follow-ups',
  linkedin: 'LinkedIn',
}

const money = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

const num = (n: number) => n.toLocaleString('en-US')

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const range = parseRange((await searchParams).range)
  const since = rangeStart(range)
  const supabase = createReadClient()

  // Effort inside the window, from every channel.
  let effortQuery = supabase
    .from('v_outreach_daily_all')
    .select('activity_date, channel, sent, replies')
  if (since) effortQuery = effortQuery.gte('activity_date', since.slice(0, 10))

  let ordersQuery = supabase
    .from('orders')
    .select(
      'display_id, amount, commission_paid, net_payout, placed_at, sales_channel, retailers(name)'
    )
    .neq('state', 'cancelled')
    .order('placed_at', { ascending: false })
  if (since) ordersQuery = ordersQuery.gte('placed_at', since)

  const [effortRes, ordersRes] = await Promise.all([
    effortQuery,
    ordersQuery.limit(500),
  ])

  const effortRows = (effortRes.data ?? []) as Array<{
    activity_date: string
    channel: string
    sent: number
    replies: number
  }>

  const orders = (ordersRes.data ?? []).map((o) => ({
    display_id: o.display_id as string | null,
    amount: Number(o.amount),
    commission: Number(o.commission_paid ?? 0),
    payout: Number(o.net_payout ?? 0),
    placed_at: o.placed_at as string,
    channel: o.sales_channel as string,
    // PostgREST types a to-one embed as an array.
    retailer:
      (Array.isArray(o.retailers) ? o.retailers[0]?.name : undefined) ?? null,
  }))

  // Effort per channel.
  const effort = new Map<string, { sent: number; replies: number }>()
  for (const r of effortRows) {
    const e = effort.get(r.channel) ?? { sent: 0, replies: 0 }
    e.sent += Number(r.sent ?? 0)
    e.replies += Number(r.replies ?? 0)
    effort.set(r.channel, e)
  }

  const revenue = orders.reduce((s, o) => s + o.amount, 0)
  const commission = orders.reduce((s, o) => s + o.commission, 0)
  const totalSent = [...effort.values()].reduce((s, e) => s + e.sent, 0)
  const totalReplies = [...effort.values()].reduce((s, e) => s + e.replies, 0)

  const directRevenue = orders
    .filter((o) => o.channel !== 'faire_marketplace')
    .reduce((s, o) => s + o.amount, 0)
  const migrationPct = revenue > 0 ? (100 * directRevenue) / revenue : null

  const buyers = new Set(orders.map((o) => o.retailer).filter(Boolean))
  const avgOrder = orders.length > 0 ? revenue / orders.length : 0

  const channels = [...effort.entries()]
    .map(([channel, e]) => ({
      channel,
      ...e,
      rate: e.sent > 0 ? (100 * e.replies) / e.sent : null,
    }))
    .filter((c) => c.sent > 0 || c.replies > 0)

  const byVolume = [...channels].sort((a, b) => b.sent - a.sent)
  const maxSent = Math.max(...byVolume.map((c) => c.sent), 0)

  const byRate = [...channels]
    .filter((c) => c.rate !== null)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
  const maxRate = Math.max(...byRate.map((c) => c.rate ?? 0), 0)

  const revByChannel = new Map<string, number>()
  for (const o of orders) {
    revByChannel.set(o.channel, (revByChannel.get(o.channel) ?? 0) + o.amount)
  }
  const revRows = [...revByChannel.entries()].sort((a, b) => b[1] - a[1])
  const maxRev = Math.max(...revRows.map(([, v]) => v), 0)

  const label = RANGES[range].label.toLowerCase()

  return (
    <main className="mx-auto max-w-5xl space-y-12 p-8">
      <header className="space-y-5 border-b border-border pb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="wordmark text-sm text-muted">Frém</p>
            <h1 className="text-3xl">Moral Compass</h1>
          </div>
          <Link
            href="/linkedin"
            className="text-xs uppercase tracking-wider underline underline-offset-4 hover:text-muted"
          >
            LinkedIn entry →
          </Link>
        </div>
        <RangeFilter active={range} />
      </header>

      {orders.length === 0 && totalSent === 0 && (
        <Empty>
          Nothing in the last {label}. Try{' '}
          <Link href="/?range=all" className="underline underline-offset-2">
            all time
          </Link>
          , or run the Faire sync to pull orders.
        </Empty>
      )}

      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Revenue" value={money(revenue)} note={`last ${label}`} />
        <Stat
          label="Commission to Faire"
          value={money(commission)}
          note={
            revenue > 0
              ? `${((100 * commission) / revenue).toFixed(1)}% of revenue`
              : 'no orders'
          }
        />
        <Stat
          label="Orders"
          value={num(orders.length)}
          note={
            orders.length > 0
              ? `${money(avgOrder)} average · ${buyers.size} buyers`
              : 'none yet'
          }
        />
        <Stat
          label="Revenue direct"
          value={migrationPct === null ? '—' : `${migrationPct.toFixed(1)}%`}
          note="off the marketplace"
        />
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Outreach volume
          </h2>
          <span className="text-xs text-muted">
            {num(totalSent)} sent · {num(totalReplies)} replies
          </span>
        </div>
        {byVolume.length === 0 ? (
          <Empty>No outreach recorded in this window.</Empty>
        ) : (
          <div>
            {byVolume.map((c) => (
              <Bar
                key={c.channel}
                label={CHANNEL_LABEL[c.channel] ?? c.channel}
                value={c.sent}
                max={maxSent}
                display={num(c.sent)}
                sub={`${num(c.replies)} replies`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Reply rate
          </h2>
          <span className="text-xs text-muted">replies ÷ sent, consistently</span>
        </div>
        {byRate.length === 0 ? (
          <Empty>No reply data in this window.</Empty>
        ) : (
          <div>
            {byRate.map((c) => (
              <Bar
                key={c.channel}
                label={CHANNEL_LABEL[c.channel] ?? c.channel}
                value={c.rate ?? 0}
                max={maxRate}
                display={`${(c.rate ?? 0).toFixed(2)}%`}
                sub={`of ${num(c.sent)}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-muted">
          Revenue by sales channel
        </h2>
        {revRows.length === 0 ? (
          <Empty>No orders in this window.</Empty>
        ) : (
          <div>
            {revRows.map(([channel, value]) => (
              <Bar
                key={channel}
                label={
                  channel === 'faire_marketplace'
                    ? 'Faire marketplace'
                    : channel === 'faire_direct'
                      ? 'Faire Direct'
                      : 'Shopify direct'
                }
                value={value}
                max={maxRev}
                display={money(value)}
                sub={channel === 'faire_marketplace' ? '15% fee' : '0% fee'}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Recent orders
          </h2>
          {orders.length > 15 && (
            <span className="text-xs text-muted">
              showing 15 of {num(orders.length)}
            </span>
          )}
        </div>
        {orders.length === 0 ? (
          <Empty>No orders in this window.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 font-normal">Retailer</th>
                  <th className="py-2 pr-4 font-normal">Channel</th>
                  <th className="py-2 pr-4 font-normal">Placed</th>
                  <th className="py-2 pr-4 text-right font-normal">Amount</th>
                  <th className="py-2 text-right font-normal">You keep</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 15).map((o) => (
                  <tr
                    key={o.display_id}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="py-2 pr-4">{o.retailer ?? '—'}</td>
                    <td className="py-2 pr-4 text-muted">
                      {o.channel === 'faire_marketplace'
                        ? 'Marketplace'
                        : o.channel === 'faire_direct'
                          ? 'Faire Direct'
                          : 'Shopify'}
                    </td>
                    <td className="numeric py-2 pr-4 text-muted">
                      {o.placed_at.slice(0, 10)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money(o.amount)}
                    </td>
                    <td className="numeric py-2 text-right">
                      {money(o.payout)}
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
