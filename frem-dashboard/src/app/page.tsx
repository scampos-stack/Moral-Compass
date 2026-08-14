import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty } from '@/components/stat'
import {
  RangeFilter,
  parseRange,
  resolveRange,
  RANGES,
} from '@/components/range-filter'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = {
  woodpecker_email: 'Email marketing (Woodpecker)',
  linkedin: 'LinkedIn',
  manual_email: 'Manual follow-ups',
  faire_campaign: 'Faire campaigns',
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const money0 = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
const num = (n: number) => n.toLocaleString('en-US')
const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)}%`)

type Perf = {
  channel: string
  sent: number
  replies: number
  opened: number
  interested: number
  reply_rate_pct: number | null
  closed: number
  revenue: number
}

export default async function Overview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>
}) {
  const sp = await searchParams
  const range = parseRange(sp.range)
  const window = resolveRange(range, sp.from, sp.to)
  const supabase = createReadClient()

  const [perfRes, migRes, ordersRes, wpRes, atwRes, fcRes, ghlRes, socialRes] =
    await Promise.all([
    supabase.from('v_channel_performance').select('*'),
    supabase.from('v_migration_rate').select('*').limit(12),
    (() => {
      // The headline figures respect the timeline; the monthly trend tables
      // below deliberately do not — a trend truncated to 7 days is not a trend.
      let q = supabase
        .from('orders')
        .select(
          'amount, commission_paid, net_payout, placed_at, sales_channel, sales_rep_name'
        )
        .neq('state', 'cancelled')
      if (window.from) q = q.gte('placed_at', window.from)
      if (window.to) q = q.lt('placed_at', window.to)
      return q.limit(20000)
    })(),
    supabase
      .from('woodpecker_campaigns')
      .select('name, status, prospects, sent, opened, replied, interested, bounced')
      .order('sent', { ascending: false }),
    supabase.from('v_atw_revenue').select('*').limit(12),
    supabase.from('v_faire_promotions').select('*').limit(15),
    supabase.from('v_ghl_pipeline_summary').select('*'),
    supabase
      .from('ghl_social_posts')
      .select('platform, posted_at')
      .order('posted_at', { ascending: false })
      .limit(200),
  ])

  const perf = ((perfRes.data ?? []) as Perf[]).map((p) => ({
    ...p,
    sent: Number(p.sent ?? 0),
    replies: Number(p.replies ?? 0),
    opened: Number(p.opened ?? 0),
    interested: Number(p.interested ?? 0),
    closed: Number(p.closed ?? 0),
    revenue: Number(p.revenue ?? 0),
  }))

  const orders = (ordersRes.data ?? []).map((o) => ({
    amount: Number(o.amount),
    commission: Number(o.commission_paid ?? 0),
    payout: Number(o.net_payout ?? 0),
    placed_at: o.placed_at as string,
    channel: o.sales_channel as string,
    rep: (o.sales_rep_name as string | null) ?? null,
  }))

  const migration = (migRes.data ?? []) as Array<{
    month: string
    total_revenue: number
    direct_revenue: number
    revenue_migration_pct: number | null
    total_buyers: number
    buyer_migration_pct: number | null
    commission_paid: number
  }>

  const campaigns = (wpRes.data ?? []) as Array<{
    name: string
    status: string | null
    prospects: number
    sent: number
    opened: number
    replied: number
    interested: number
    bounced: number
  }>

  const atw = (atwRes.data ?? []) as Array<{
    month: string
    atw_orders: number
    atw_revenue: number
    atw_commission: number
    untagged_orders: number
    untagged_revenue: number
    total_revenue: number
    atw_share_pct: number | null
  }>

  const promotions = (fcRes.data ?? []) as Array<{
    code: string
    orders: number
    buyers: number
    revenue: number
    atw_orders: number
    last_order: string
  }>

  const atwTotal = atw.reduce((s, m) => s + Number(m.atw_revenue), 0)
  const atwOrders = atw.reduce((s, m) => s + Number(m.atw_orders), 0)

  const pipelines = (ghlRes.data ?? []) as Array<{
    pipeline: string
    opportunities: number
    open_count: number
    won_count: number
    lost_count: number
    open_value: number
    won_value: number
    win_rate_pct: number | null
  }>

  const social = (socialRes.data ?? []) as Array<{
    platform: string | null
    posted_at: string | null
  }>

  // Posts per platform in the last 30 days — the Trust Gap the proposal
  // names is about visible, recent activity, not lifetime totals.
  const socialCut = (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 30)
    return d.toISOString()
  })()
  const socialRecent = social.filter(
    (p) => p.posted_at && p.posted_at >= socialCut
  )
  const byPlatform = new Map<string, number>()
  for (const p of socialRecent) {
    const k = p.platform ?? 'unknown'
    byPlatform.set(k, (byPlatform.get(k) ?? 0) + 1)
  }

  // ── Revenue, all-time, straight from synced Faire orders ────────────────
  const revenue = orders.reduce((s, o) => s + o.amount, 0)
  const commission = orders.reduce((s, o) => s + o.commission, 0)
  const payout = orders.reduce((s, o) => s + o.payout, 0)
  const directRevenue = orders
    .filter((o) => o.channel !== 'faire_marketplace')
    .reduce((s, o) => s + o.amount, 0)
  const migrationPct = revenue > 0 ? (100 * directRevenue) / revenue : null

  const last30 = (() => {
    const cut = new Date()
    cut.setUTCDate(cut.getUTCDate() - 30)
    const iso = cut.toISOString()
    const recent = orders.filter((o) => o.placed_at >= iso)
    return { count: recent.length, value: recent.reduce((s, o) => s + o.amount, 0) }
  })()

  const totals = perf.reduce(
    (a, p) => ({
      sent: a.sent + p.sent,
      replies: a.replies + p.replies,
      closed: a.closed + p.closed,
      revenue: a.revenue + p.revenue,
    }),
    { sent: 0, replies: 0, closed: 0, revenue: 0 }
  )
  const totalRate = totals.sent > 0 ? (100 * totals.replies) / totals.sent : null

  const rows = [...perf].sort((a, b) => b.sent - a.sent)

  // Rep split inside the selected window, so the ATW tiles move with the
  // dropdown instead of always reporting all time.
  const repWindow = orders.reduce(
    (a, o) => {
      const bucket = o.rep === 'ATW' ? 'atw' : o.rep ? 'other' : 'untagged'
      a[bucket].orders += 1
      a[bucket].revenue += o.amount
      return a
    },
    {
      atw: { orders: 0, revenue: 0 },
      other: { orders: 0, revenue: 0 },
      untagged: { orders: 0, revenue: 0 },
    }
  )

  return (
    <main className="mx-auto max-w-6xl space-y-12 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <RangeFilter active={range} from={sp.from} to={sp.to} />
        <span className="text-xs text-muted">
          {RANGES[range]} · {num(orders.length)} orders
        </span>
      </div>

      {/* ── Headline ──────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Revenue"
          value={money0(revenue)}
          note={`${num(orders.length)} orders, all time`}
        />
        <Stat
          label="You keep"
          value={money0(payout)}
          note={`${money0(commission)} to Faire`}
        />
        <Stat
          label="Revenue direct"
          value={migrationPct === null ? '—' : `${migrationPct.toFixed(1)}%`}
          note="off the marketplace"
        />
        <Stat
          label="Last 30 days"
          value={money0(last30.value)}
          note={`${num(last30.count)} orders`}
        />
      </section>

      {/* ── A-Teamwork attributed revenue ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            A-Teamwork attributed revenue
          </h2>
          <span className="text-xs text-muted">
            Faire orders tagged rep &ldquo;ATW&rdquo;
          </span>
        </div>

        {atw.length === 0 ? (
          <Empty>
            No ATW-tagged orders yet. Run migration 0006 and re-sync Faire —
            the tag is in the order payload but was not being stored.
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat
                label="ATW (agency)"
                value={money0(repWindow.atw.revenue)}
                note={`${num(repWindow.atw.orders)} orders`}
              />
              <Stat
                label="Other rep (in-house)"
                value={money0(repWindow.other.revenue)}
                note={`${num(repWindow.other.orders)} orders`}
              />
              <Stat
                label="Untagged"
                value={money0(repWindow.untagged.revenue)}
                note={`${num(repWindow.untagged.orders)} orders`}
              />
              <Stat
                label="ATW share"
                value={
                  revenue > 0
                    ? `${((100 * repWindow.atw.revenue) / revenue).toFixed(1)}%`
                    : '—'
                }
                note={RANGES[range].toLowerCase()}
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                    <th className="py-2 pr-4 text-left font-normal">Month</th>
                    <th className="py-2 pr-4 text-right font-normal">ATW orders</th>
                    <th className="py-2 pr-4 text-right font-normal">ATW revenue</th>
                    <th className="py-2 pr-4 text-right font-normal">Share</th>
                    <th className="py-2 pr-4 text-right font-normal">Untagged</th>
                    <th className="py-2 text-right font-normal">Month total</th>
                  </tr>
                </thead>
                <tbody>
                  {atw.map((m) => (
                    <tr
                      key={m.month}
                      className="border-b border-border transition-colors hover:bg-surface-muted"
                    >
                      <td className="numeric py-2 pr-4">{m.month.slice(0, 7)}</td>
                      <td className="numeric py-2 pr-4 text-right">
                        {num(Number(m.atw_orders))}
                      </td>
                      <td className="numeric py-2 pr-4 text-right">
                        {money0(Number(m.atw_revenue))}
                      </td>
                      <td className="numeric py-2 pr-4 text-right">
                        {m.atw_share_pct === null ? '—' : `${m.atw_share_pct}%`}
                      </td>
                      <td className="numeric py-2 pr-4 text-right text-muted">
                        {money0(Number(m.untagged_revenue))}
                      </td>
                      <td className="numeric py-2 text-right">
                        {money0(Number(m.total_revenue))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted">
              The ATW tag is applied by hand in Faire, so this is a floor rather
              than a total — an untagged order may still be ours. The untagged
              column is shown so any gap stays visible instead of quietly
              lowering the number.
            </p>
          </>
        )}
      </section>

      {/* ── Faire promotions by discount code ──────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Faire promotions
          </h2>
          <span className="text-xs text-muted">discount codes redeemed at checkout — not email campaigns</span>
        </div>

        {promotions.length === 0 ? (
          <Empty>No campaign codes yet. Needs migration 0006 and a re-sync.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 text-left font-normal">Code</th>
                  <th className="py-2 pr-4 text-right font-normal">Orders</th>
                  <th className="py-2 pr-4 text-right font-normal">Buyers</th>
                  <th className="py-2 pr-4 text-right font-normal">ATW</th>
                  <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                  <th className="py-2 text-right font-normal">Last order</th>
                </tr>
              </thead>
              <tbody>
                {promotions.map((c) => (
                  <tr
                    key={c.code}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="py-2 pr-4">{c.code}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(c.orders))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(c.buyers))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(c.atw_orders))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money0(Number(c.revenue))}
                    </td>
                    <td className="numeric py-2 text-right text-muted">
                      {c.last_order}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          An order carrying two codes counts toward both, so these rows do not
          sum to total revenue. They answer what each campaign touched.
        </p>
      </section>

      {/* ── Performance table ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Performance by source
          </h2>
          <span className="text-xs text-muted">
            response % is replies ÷ sent, for every source
          </span>
        </div>

        {rows.length === 0 ? (
          <Empty>No outreach data. Run the syncs.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 text-left font-normal">Source</th>
                  <th className="py-2 pr-4 text-right font-normal">Total</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 pr-4 text-right font-normal">Response</th>
                  <th className="py-2 pr-4 text-right font-normal">Response %</th>
                  <th className="py-2 pr-4 text-right font-normal">Interested</th>
                  <th className="py-2 pr-4 text-right font-normal">Closed</th>
                  <th className="py-2 text-right font-normal">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.channel}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="py-2 pr-4">
                      {SOURCE_LABEL[r.channel] ?? r.channel}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">{num(r.sent)}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(r.opened)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(r.replies)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {pct(r.reply_rate_pct)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(r.interested)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(r.closed)}
                    </td>
                    <td className="numeric py-2 text-right">
                      {r.revenue > 0 ? money(r.revenue) : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="border-b-2 border-foreground font-medium">
                  <td className="py-2 pr-4">Total</td>
                  <td className="numeric py-2 pr-4 text-right">
                    {num(totals.sent)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="numeric py-2 pr-4 text-right">
                    {num(totals.replies)}
                  </td>
                  <td className="numeric py-2 pr-4 text-right">
                    {pct(totalRate)}
                  </td>
                  <td className="py-2 pr-4" />
                  <td className="numeric py-2 pr-4 text-right">
                    {num(totals.closed)}
                  </td>
                  <td className="numeric py-2 text-right">
                    {totals.revenue > 0 ? money(totals.revenue) : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {totals.revenue === 0 && revenue > 0 && (
          <p className="text-xs text-muted">
            Revenue is not split by source yet. Faire exposes no buyer email, so
            an order can only be tied to outreach by matching company names —
            that runs once Woodpecker prospects are imported. The{' '}
            {money0(revenue)} above is real and complete; only its attribution
            to a channel is pending.
          </p>
        )}
      </section>

      {/* ── Woodpecker campaigns ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-wider text-muted">
          Email campaigns
        </h2>
        {campaigns.length === 0 ? (
          <Empty>No Woodpecker data. Run the Woodpecker sync.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 text-left font-normal">Campaign</th>
                  <th className="py-2 pr-4 text-left font-normal">Status</th>
                  <th className="py-2 pr-4 text-right font-normal">Sent</th>
                  <th className="py-2 pr-4 text-right font-normal">Opened</th>
                  <th className="py-2 pr-4 text-right font-normal">Open %</th>
                  <th className="py-2 pr-4 text-right font-normal">Replied</th>
                  <th className="py-2 pr-4 text-right font-normal">Reply %</th>
                  <th className="py-2 text-right font-normal">Interested</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.name}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="py-2 pr-4">{c.name}</td>
                    <td className="py-2 pr-4 text-xs uppercase tracking-wider text-muted">
                      {c.status?.toLowerCase() ?? '—'}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">{num(c.sent)}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(c.opened)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {c.sent > 0 ? `${((100 * c.opened) / c.sent).toFixed(1)}%` : '—'}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(c.replied)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {c.sent > 0 ? `${((100 * c.replied) / c.sent).toFixed(2)}%` : '—'}
                    </td>
                    <td className="numeric py-2 text-right">
                      {num(c.interested)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── GoHighLevel pipelines ─────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Pipelines (GoHighLevel)
          </h2>
          <span className="text-xs text-muted">
            open value is pipeline, won value is money
          </span>
        </div>

        {pipelines.length === 0 ? (
          <Empty>No pipeline data. Run the GoHighLevel sync.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 text-left font-normal">Pipeline</th>
                  <th className="py-2 pr-4 text-right font-normal">Opps</th>
                  <th className="py-2 pr-4 text-right font-normal">Open</th>
                  <th className="py-2 pr-4 text-right font-normal">Won</th>
                  <th className="py-2 pr-4 text-right font-normal">Lost</th>
                  <th className="py-2 pr-4 text-right font-normal">Win %</th>
                  <th className="py-2 pr-4 text-right font-normal">Open value</th>
                  <th className="py-2 text-right font-normal">Won value</th>
                </tr>
              </thead>
              <tbody>
                {pipelines.map((p) => (
                  <tr
                    key={p.pipeline}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="py-2 pr-4">{p.pipeline}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(p.opportunities))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(p.open_count))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(Number(p.won_count))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right text-muted">
                      {num(Number(p.lost_count))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {p.win_rate_pct === null ? '—' : `${p.win_rate_pct}%`}
                    </td>
                    <td className="numeric py-2 pr-4 text-right text-muted">
                      {money0(Number(p.open_value))}
                    </td>
                    <td className="numeric py-2 text-right">
                      {money0(Number(p.won_value))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pipelines.some(
          (p) => /chain/i.test(p.pipeline) && Number(p.open_value) === 0
        ) && (
          <p className="text-xs text-muted">
            Chain Store carries no deal values. LinkedIn revenue is recorded
            here, so until amounts are entered on those opportunities the
            LinkedIn row cannot show money — only effort.
          </p>
        )}
      </section>

      {/* ── Social ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Social activity
          </h2>
          <span className="text-xs text-muted">last 30 days</span>
        </div>

        {byPlatform.size === 0 ? (
          <Empty>
            No posts in the last 30 days. Wholesale buyers check social before
            ordering — the proposal calls this the Trust Gap.
          </Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[...byPlatform.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([platform, count]) => (
                <Stat
                  key={platform}
                  label={platform}
                  value={num(count)}
                  note="posts in 30 days"
                />
              ))}
          </div>
        )}
      </section>

      {/* ── Migration off Faire ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs uppercase tracking-wider text-muted">
            Migration off Faire
          </h2>
          <span className="text-xs text-muted">
            buyer share is the honest measure
          </span>
        </div>
        {migration.length === 0 ? (
          <Empty>No orders synced yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 text-left font-normal">Month</th>
                  <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                  <th className="py-2 pr-4 text-right font-normal">Direct</th>
                  <th className="py-2 pr-4 text-right font-normal">Direct %</th>
                  <th className="py-2 pr-4 text-right font-normal">Buyers</th>
                  <th className="py-2 pr-4 text-right font-normal">Buyer %</th>
                  <th className="py-2 text-right font-normal">To Faire</th>
                </tr>
              </thead>
              <tbody>
                {migration.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-border transition-colors hover:bg-surface-muted"
                  >
                    <td className="numeric py-2 pr-4">{m.month.slice(0, 7)}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money0(Number(m.total_revenue))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {money0(Number(m.direct_revenue))}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {m.revenue_migration_pct === null
                        ? '—'
                        : `${m.revenue_migration_pct}%`}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {num(m.total_buyers)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {m.buyer_migration_pct === null
                        ? '—'
                        : `${m.buyer_migration_pct}%`}
                    </td>
                    <td className="numeric py-2 text-right">
                      {money0(Number(m.commission_paid))}
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
