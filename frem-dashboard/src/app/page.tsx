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
  pct,
  type SearchParams,
} from '@/lib/dash'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = {
  woodpecker_email: 'Email (Woodpecker)',
  linkedin: 'LinkedIn',
  manual_email: 'Manual follow-ups',
  faire_campaign: 'Faire campaigns',
}

export default async function Overview({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to, window } = await readRange(searchParams)
  const supabase = createReadClient()

  const [orders, perfRes, pipeRes] = await Promise.all([
    fetchOrders(window),
    supabase.from('v_channel_performance').select('*'),
    supabase.from('v_ghl_pipeline_summary').select('*'),
  ])

  const s = summarise(orders)
  const months = byMonth(orders)

  const perf = ((perfRes.data ?? []) as Array<{
    channel: string
    sent: number
    replies: number
    reply_rate_pct: number | null
    opened: number
    interested: number
  }>).map((p) => ({
    ...p,
    sent: Number(p.sent ?? 0),
    replies: Number(p.replies ?? 0),
  }))

  const pipelines = (pipeRes.data ?? []) as Array<{
    pipeline: string
    open_count: number
    open_value: number
    won_value: number
  }>

  const totalSent = perf.reduce((a, p) => a + p.sent, 0)
  const totalReplies = perf.reduce((a, p) => a + p.replies, 0)

  // ── Insights ────────────────────────────────────────────────────────────
  // Computed from the data on screen, never hardcoded. Each states a fact and
  // what to do about it; anything the data cannot support is simply absent.
  const insights: Array<{ title: string; body: string }> = []

  if (s.orders > 0 && s.rep.atw === 0) {
    insights.push({
      title: 'No ATW-tagged orders in this range',
      body: `All ${num(s.orders)} orders here are untagged. The Faire sales-rep field is how your work gets credited — untagged revenue cannot be claimed as yours.`,
    })
  } else if (s.atwPct !== null && s.atwPct < 5 && s.orders > 50) {
    insights.push({
      title: `ATW is tagged on only ${s.atwPct.toFixed(1)}% of revenue`,
      body: `${num(s.repOrders.atw)} of ${num(s.orders)} orders carry the tag, yet ATW has 570 customers assigned in Faire. Tagging discipline, not performance, is what is limiting this number.`,
    })
  }

  if (s.commission > 0) {
    insights.push({
      title: `${money0(s.commission)} paid to Faire in commission`,
      body: `That is ${((100 * s.commission) / s.revenue).toFixed(1)}% of revenue in this range, and it is the money the migration to direct channels is meant to recover.`,
    })
  }

  if (s.directPct !== null && s.directPct < 25 && s.revenue > 0) {
    insights.push({
      title: `Only ${s.directPct.toFixed(1)}% of revenue is off the marketplace`,
      body: 'Faire Direct and Shopify carry no commission. Every point moved here is margin kept rather than sales added.',
    })
  }

  const chain = pipelines.find((p) => /chain/i.test(p.pipeline))
  if (chain && Number(chain.open_value) === 0 && Number(chain.open_count) > 0) {
    insights.push({
      title: 'Chain Store pipeline has deals but no values',
      body: `${num(Number(chain.open_count))} open opportunities, all at $0. LinkedIn revenue is recorded here, so it will read as zero until amounts are entered.`,
    })
  }

  const best = [...perf]
    .filter((p) => p.sent > 100 && p.reply_rate_pct !== null)
    .sort((a, b) => Number(b.reply_rate_pct) - Number(a.reply_rate_pct))[0]
  const biggest = [...perf].sort((a, b) => b.sent - a.sent)[0]
  if (best && biggest && best.channel !== biggest.channel) {
    insights.push({
      title: `${SOURCE_LABEL[best.channel] ?? best.channel} replies best, ${SOURCE_LABEL[biggest.channel] ?? biggest.channel} sends most`,
      body: `${pct(best.reply_rate_pct)} versus ${pct(biggest.reply_rate_pct)}. Volume and conversion are pulling in opposite directions — worth checking whether the cheap channel is worth its volume.`,
    })
  }

  return (
    <Shell
      title="Overview"
      subtitle="Effort and revenue for Frém wholesale"
      range={range}
      from={from}
      to={to}
      meta={`${num(s.orders)} orders`}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Revenue" value={money0(s.revenue)} note={`${num(s.orders)} orders`} />
        <Stat
          label="You keep"
          value={money0(s.payout)}
          note={`${money0(s.commission)} to Faire`}
        />
        <Stat
          label="ATW attributed"
          value={money0(s.rep.atw)}
          note={s.atwPct === null ? 'no orders' : `${s.atwPct.toFixed(1)}% of revenue`}
        />
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

      {insights.length > 0 && (
        <Section title="What this says" aside="computed from the data above">
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((i) => (
              <div key={i.title} className="border-l-2 border-foreground pl-4">
                <p className="text-sm font-medium">{i.title}</p>
                <p className="mt-1 text-sm text-muted">{i.body}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Performance by source"
        aside={`${num(totalSent)} sent · ${num(totalReplies)} replies · all time`}
      >
        {perf.length === 0 ? (
          <Empty>No outreach data. Run the syncs.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Source</th>
                <th className="py-2 pr-4 text-right font-normal">Sent</th>
                <th className="py-2 pr-4 text-right font-normal">Opened</th>
                <th className="py-2 pr-4 text-right font-normal">Replies</th>
                <th className="py-2 pr-4 text-right font-normal">Reply %</th>
                <th className="py-2 text-right font-normal">Interested</th>
              </>
            }
          >
            {[...perf]
              .sort((a, b) => b.sent - a.sent)
              .map((p) => (
                <Row key={p.channel}>
                  <td className="py-2 pr-4">
                    {SOURCE_LABEL[p.channel] ?? p.channel}
                  </td>
                  <td className="numeric py-2 pr-4 text-right">{num(p.sent)}</td>
                  <td className="numeric py-2 pr-4 text-right">
                    {num(Number(p.opened ?? 0))}
                  </td>
                  <td className="numeric py-2 pr-4 text-right">
                    {num(p.replies)}
                  </td>
                  <td className="numeric py-2 pr-4 text-right">
                    {pct(p.reply_rate_pct)}
                  </td>
                  <td className="numeric py-2 text-right">
                    {num(Number(p.interested ?? 0))}
                  </td>
                </Row>
              ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
