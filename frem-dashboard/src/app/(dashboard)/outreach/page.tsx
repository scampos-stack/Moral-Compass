import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty, Bar } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { readRange, num, pct, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = {
  woodpecker_email: 'Email (Woodpecker)',
  linkedin: 'LinkedIn',
  manual_email: 'Manual follow-ups',
  faire_campaign: 'Faire campaigns',
}

export default async function OutreachPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()

  const [perfRes, wpRes, liRes] = await Promise.all([
    supabase.from('v_channel_performance').select('*'),
    supabase
      .from('woodpecker_campaigns')
      .select(
        'name, status, prospects, sent, delivered, opened, clicked, replied, interested, bounced, optout'
      )
      .order('sent', { ascending: false }),
    supabase
      .from('linkedin_daily')
      .select(
        'activity_date, connections_sent, connections_accepted, inmails, replies_total, notes'
      )
      .order('activity_date', { ascending: false })
      .limit(60),
  ])

  const perf = ((perfRes.data ?? []) as Array<{
    channel: string
    sent: number
    replies: number
    opened: number
    interested: number
    reply_rate_pct: number | null
  }>).map((p) => ({
    ...p,
    sent: Number(p.sent ?? 0),
    replies: Number(p.replies ?? 0),
    opened: Number(p.opened ?? 0),
  }))

  const wp = (wpRes.data ?? []) as Array<{
    name: string
    status: string | null
    prospects: number
    sent: number
    delivered: number
    opened: number
    clicked: number
    replied: number
    interested: number
    bounced: number
    optout: number
  }>

  const li = (liRes.data ?? []) as Array<{
    activity_date: string
    connections_sent: number
    connections_accepted: number
    inmails: number
    replies_total: number
    notes: string | null
  }>

  const totalSent = perf.reduce((a, p) => a + p.sent, 0)
  const totalReplies = perf.reduce((a, p) => a + p.replies, 0)
  const overallRate = totalSent > 0 ? (100 * totalReplies) / totalSent : null

  const byRate = [...perf]
    .filter((p) => p.reply_rate_pct !== null)
    .sort((a, b) => Number(b.reply_rate_pct) - Number(a.reply_rate_pct))
  const maxRate = Math.max(...byRate.map((p) => Number(p.reply_rate_pct)), 0)

  const byVolume = [...perf].sort((a, b) => b.sent - a.sent)
  const maxSent = Math.max(...byVolume.map((p) => p.sent), 0)

  const liSent = li.reduce(
    (a, d) => a + Number(d.connections_sent) + Number(d.inmails),
    0
  )
  const liAccepted = li.reduce((a, d) => a + Number(d.connections_accepted), 0)
  const liReplies = li.reduce((a, d) => a + Number(d.replies_total), 0)
  const liConnSent = li.reduce((a, d) => a + Number(d.connections_sent), 0)

  return (
    <Shell
      title="Outreach"
      subtitle="Woodpecker email and LinkedIn — the effort side"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Touches sent" value={num(totalSent)} note="all sources" />
        <Stat label="Replies" value={num(totalReplies)} note="all sources" />
        <Stat
          label="Reply rate"
          value={pct(overallRate)}
          note="replies ÷ sent"
        />
        <Stat
          label="Campaigns"
          value={num(wp.length)}
          note="Woodpecker sequences"
        />
      </section>

      <Section title="Reply rate by source" aside="replies ÷ sent, consistently">
        {byRate.length === 0 ? (
          <Empty>No outreach data. Run the syncs.</Empty>
        ) : (
          <div>
            {byRate.map((p) => (
              <Bar
                key={p.channel}
                label={SOURCE_LABEL[p.channel] ?? p.channel}
                value={Number(p.reply_rate_pct)}
                max={maxRate}
                display={pct(p.reply_rate_pct)}
                sub={`of ${num(p.sent)}`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Volume by source" aside="the inverse of the chart above">
        {byVolume.length === 0 ? (
          <Empty>No outreach data.</Empty>
        ) : (
          <div>
            {byVolume.map((p) => (
              <Bar
                key={p.channel}
                label={SOURCE_LABEL[p.channel] ?? p.channel}
                value={p.sent}
                max={maxSent}
                display={num(p.sent)}
                sub={`${num(p.replies)} replies`}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Woodpecker campaigns" aside="lifetime totals per sequence">
        {wp.length === 0 ? (
          <Empty>No Woodpecker data. Run the Woodpecker sync.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Campaign</th>
                <th className="py-2 pr-4 text-left font-normal">Status</th>
                <th className="py-2 pr-4 text-right font-normal">Sent</th>
                <th className="py-2 pr-4 text-right font-normal">Open %</th>
                <th className="py-2 pr-4 text-right font-normal">Replied</th>
                <th className="py-2 pr-4 text-right font-normal">Reply %</th>
                <th className="py-2 pr-4 text-right font-normal">Interested</th>
                <th className="py-2 text-right font-normal">Bounced</th>
              </>
            }
          >
            {wp.map((c) => (
              <Row key={c.name}>
                <td className="py-2 pr-4">{c.name}</td>
                <td className="py-2 pr-4 text-xs uppercase tracking-wider text-muted">
                  {c.status?.toLowerCase() ?? '—'}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.sent))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.sent > 0
                    ? `${((100 * c.opened) / c.sent).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.replied))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.sent > 0
                    ? `${((100 * c.replied) / c.sent).toFixed(2)}%`
                    : '—'}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.interested))}
                </td>
                <td className="numeric py-2 text-right text-muted">
                  {num(Number(c.bounced))}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section
        title="LinkedIn"
        aside="used for closing deals — values land in the Chain Store pipeline"
      >
        <div className="mb-4 grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat label="Touches" value={num(liSent)} note="requests + InMail" />
          <Stat
            label="Accepted"
            value={num(liAccepted)}
            note={
              liConnSent > 0
                ? `${((100 * liAccepted) / liConnSent).toFixed(1)}% of requests`
                : '—'
            }
          />
          <Stat label="Replies" value={num(liReplies)} note="all sentiments" />
          <Stat
            label="Reply rate"
            value={liSent > 0 ? `${((100 * liReplies) / liSent).toFixed(2)}%` : '—'}
            note="replies ÷ touches"
          />
        </div>

        {li.length === 0 ? (
          <Empty>
            No LinkedIn days recorded. Add them on the LinkedIn entry page.
          </Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Date</th>
                <th className="py-2 pr-4 text-right font-normal">Sent</th>
                <th className="py-2 pr-4 text-right font-normal">Accepted</th>
                <th className="py-2 pr-4 text-right font-normal">Accept %</th>
                <th className="py-2 pr-4 text-right font-normal">InMails</th>
                <th className="py-2 pr-4 text-right font-normal">Replies</th>
                <th className="py-2 text-left font-normal">Notes</th>
              </>
            }
          >
            {li.slice(0, 20).map((d) => (
              <Row key={d.activity_date}>
                <td className="numeric py-2 pr-4">{d.activity_date}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(d.connections_sent))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(d.connections_accepted))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {d.connections_sent > 0
                    ? `${((100 * d.connections_accepted) / d.connections_sent).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(d.inmails))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(d.replies_total))}
                </td>
                <td className="py-2 text-muted">{d.notes ?? ''}</td>
              </Row>
            ))}
          </Table>
        )}
        <p className="text-xs text-muted">
          Accept % divides by connection requests only, excluding InMail —
          an InMail cannot be &ldquo;accepted&rdquo;.
        </p>
      </Section>
    </Shell>
  )
}
