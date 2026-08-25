import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { TimeBars, TwoToneLegend } from '@/components/chart'
import {
  readRange,
  fetchOrders,
  summarise,
  byMonth,
  money0,
  num,
  type SearchParams,
} from '@/lib/dash'

export const dynamic = 'force-dynamic'

export default async function FairePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to, window } = await readRange(searchParams)
  const supabase = createReadClient()

  const [orders, promoRes, migRes, repRes, manualRes] = await Promise.all([
    fetchOrders(window),
    supabase.from('v_faire_promotions').select('*').limit(25),
    supabase.from('v_migration_rate').select('*').limit(18),
    supabase.from('v_rep_revenue').select('*').limit(100),
    supabase
      .from('faire_campaigns_manual')
      .select('*')
      .order('sent_on', { ascending: false })
      .limit(30),
  ])

  const s = summarise(orders)
  const months = byMonth(orders)

  const promos = (promoRes.data ?? []) as Array<{
    code: string
    orders: number
    buyers: number
    revenue: number
    atw_orders: number
    last_order: string
  }>

  const migration = (migRes.data ?? []) as Array<{
    month: string
    total_revenue: number
    direct_revenue: number
    revenue_migration_pct: number | null
    total_buyers: number
    buyer_migration_pct: number | null
    commission_paid: number
  }>

  const reps = (repRes.data ?? []) as Array<{
    month: string
    rep: string
    orders: number
    revenue: number
  }>

  const manual = (manualRes.data ?? []) as Array<{
    id: string
    name: string
    sent_on: string
    delivered: number
    open_rate_pct: number | null
    click_rate_pct: number | null
    orders_from_opens: number
    orders_from_clicks: number
    volume_from_opens: number
    volume_from_clicks: number
  }>

  // Rep totals across every month the view returns. This table is a history,
  // so it deliberately ignores the timeline above.
  const repTotals = new Map<string, { orders: number; revenue: number }>()
  for (const r of reps) {
    const e = repTotals.get(r.rep) ?? { orders: 0, revenue: 0 }
    e.orders += Number(r.orders)
    e.revenue += Number(r.revenue)
    repTotals.set(r.rep, e)
  }

  return (
    <Shell
      title="Faire"
      subtitle="Marketplace revenue, promotions, and the move to direct"
      range={range}
      from={from}
      to={to}
      meta={`${num(s.orders)} orders`}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Revenue"
          value={money0(s.revenue)}
          note={`${num(s.orders)} orders`}
        />
        <Stat
          label="Commission"
          value={money0(s.commission)}
          note={
            s.revenue > 0
              ? `${((100 * s.commission) / s.revenue).toFixed(1)}% of revenue`
              : 'no orders'
          }
        />
        <Stat label="Average order" value={money0(s.avg)} note="in this range" />
        <Stat
          label="Direct (0% fee)"
          value={s.directPct === null ? '—' : `${s.directPct.toFixed(1)}%`}
          note={money0(s.direct)}
        />
      </section>

      <Section
        title="Revenue by month"
        aside="solid = tagged to ATW, tint = everything else"
      >
        <TimeBars data={months} format={money0} />
        <TwoToneLegend whole="All other revenue" part="ATW tagged" />
      </Section>

      <Section
        title="Revenue by sales rep"
        aside="all time — Faire's sales-rep field"
      >
        {repTotals.size === 0 ? (
          <Empty>No orders synced.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Rep</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 text-right font-normal">Revenue</th>
              </>
            }
          >
            {[...repTotals.entries()]
              .sort((a, b) => b[1].revenue - a[1].revenue)
              .map(([rep, v]) => (
                <Row key={rep}>
                  <td className="py-2 pr-4">{rep}</td>
                  <td className="numeric py-2 pr-4 text-right">
                    {num(v.orders)}
                  </td>
                  <td className="numeric py-2 text-right">
                    {money0(v.revenue)}
                  </td>
                </Row>
              ))}
          </Table>
        )}
        <p className="text-xs text-muted">
          Tagging is manual, so an untagged order is not proof it was not
          yours — it only means nobody set the field.
        </p>
      </Section>

      <Section
        title="Faire email campaigns"
        aside="entered by hand — Faire exposes no marketing API"
      >
        {manual.length === 0 ? (
          <Empty>
            Nothing entered yet. Faire has no endpoint for Marketing →
            Campaigns, so these numbers are copied from the Faire screen.
          </Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Campaign</th>
                <th className="py-2 pr-4 text-left font-normal">Sent</th>
                <th className="py-2 pr-4 text-right font-normal">Delivered</th>
                <th className="py-2 pr-4 text-right font-normal">Open %</th>
                <th className="py-2 pr-4 text-right font-normal">Click %</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 text-right font-normal">Volume</th>
              </>
            }
          >
            {manual.map((c) => (
              <Row key={c.id}>
                <td className="py-2 pr-4">{c.name}</td>
                <td className="numeric py-2 pr-4 text-muted">{c.sent_on}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.delivered))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.open_rate_pct === null ? '—' : `${c.open_rate_pct}%`}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.click_rate_pct === null ? '—' : `${c.click_rate_pct}%`}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(
                    Number(c.orders_from_opens) + Number(c.orders_from_clicks)
                  )}
                </td>
                <td className="numeric py-2 text-right">
                  {money0(
                    Number(c.volume_from_opens) + Number(c.volume_from_clicks)
                  )}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="Promotions"
        aside="discount codes redeemed at checkout — not email sends"
      >
        {promos.length === 0 ? (
          <Empty>No promotion codes on any synced order.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Code</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 pr-4 text-right font-normal">Buyers</th>
                <th className="py-2 pr-4 text-right font-normal">ATW</th>
                <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                <th className="py-2 text-right font-normal">Last used</th>
              </>
            }
          >
            {promos.map((p) => (
              <Row key={p.code}>
                <td className="py-2 pr-4">{p.code}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.orders))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.buyers))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.atw_orders))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {money0(Number(p.revenue))}
                </td>
                <td className="numeric py-2 text-right text-muted">
                  {p.last_order}
                </td>
              </Row>
            ))}
          </Table>
        )}
        <p className="text-xs text-muted">
          An order carrying two codes counts under both, so these rows do not
          sum to total revenue.
        </p>
      </Section>

      <Section
        title="Migration off the marketplace"
        aside="buyer share is the honest measure"
      >
        {migration.length === 0 ? (
          <Empty>No orders synced.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Month</th>
                <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                <th className="py-2 pr-4 text-right font-normal">Direct</th>
                <th className="py-2 pr-4 text-right font-normal">Direct %</th>
                <th className="py-2 pr-4 text-right font-normal">Buyers</th>
                <th className="py-2 pr-4 text-right font-normal">Buyer %</th>
                <th className="py-2 text-right font-normal">To Faire</th>
              </>
            }
          >
            {migration.map((m) => (
              <Row key={m.month}>
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
                  {num(Number(m.total_buyers))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {m.buyer_migration_pct === null
                    ? '—'
                    : `${m.buyer_migration_pct}%`}
                </td>
                <td className="numeric py-2 text-right">
                  {money0(Number(m.commission_paid))}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
