import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty, Bar } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { readRange, num, money, pct, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

/**
 * Campaign links — the tagged ones, and the traffic that carries no tag.
 *
 * These sat as two small bars at the bottom of the Shopify page, where a
 * five-session campaign is invisible beside Instagram's sixty-nine. A link
 * somebody is actively sending out needs its own place, or nobody looks.
 *
 * No date filter: a campaign's own start and end are the interesting dates,
 * and they differ per campaign. Each row carries its first and last month
 * instead.
 */

type Campaign = {
  utm_campaign: string
  utm_source: string
  utm_medium: string
  sessions: number
  sessions_recent: number
  first_month: string
  last_month: string
  orders: number
  revenue: number
  conversion_pct: number | null
}

type Tagging = {
  month: string
  tagged: number
  sourced_only: number
  untagged: number
  total: number
}

const monthLabel = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })

/**
 * A campaign is "live" if it saw traffic this month or last. Anything older
 * is reported as ended rather than as a small number, because a dead link
 * and a quiet one need different responses.
 */
function isLive(lastMonth: string): boolean {
  const now = new Date()
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  )
  return new Date(`${lastMonth.slice(0, 7)}-01T00:00:00Z`) >= cutoff
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()

  const [campRes, tagRes, landingRes] = await Promise.all([
    supabase.from('v_campaign_performance').select('*').limit(100),
    supabase.from('v_traffic_tagging').select('*').limit(24),
    supabase
      .from('shopify_sessions')
      .select('landing_path, sessions')
      .eq('window_days', 30)
      .not('landing_path', 'is', null)
      .order('sessions', { ascending: false })
      .limit(50),
  ])

  if (campRes.error) {
    return (
      <Shell
        title="Campaign links"
        subtitle="Tagged links, their traffic, and what converts"
        range={range}
        from={from}
        to={to}
        showFilter={false}
      >
        <Empty>
          Not set up yet. Apply the 0018 migration, then run a Shopify sync to
          build the twelve-month series.
        </Empty>
      </Shell>
    )
  }

  const campaigns = (campRes.data ?? []) as Campaign[]
  const tagging = (tagRes.data ?? []) as Tagging[]
  const landing = (landingRes.data ?? []) as Array<{
    landing_path: string
    sessions: number
  }>

  const live = campaigns.filter((c) => isLive(c.last_month))
  const ended = campaigns.filter((c) => !isLive(c.last_month))

  const totals = tagging.reduce(
    (a, t) => ({
      tagged: a.tagged + Number(t.tagged ?? 0),
      total: a.total + Number(t.total ?? 0),
    }),
    { tagged: 0, total: 0 }
  )
  const taggedShare = totals.total > 0 ? (100 * totals.tagged) / totals.total : 0
  const campaignOrders = campaigns.reduce((a, c) => a + Number(c.orders), 0)
  const maxMonth = Math.max(...tagging.map((t) => Number(t.total ?? 0)), 0)

  // Pages people land on that carry no campaign tag at all. The registration
  // page is the one that matters: the VIP loyalty link points at it without
  // utm_ parameters, so its clicks are indistinguishable from anyone using
  // the "create account" button in the header.
  const untrackedLanding = landing.filter((l) =>
    /account|register|login|loyalty|vip/i.test(l.landing_path)
  )

  return (
    <Shell
      title="Campaign links"
      subtitle="Tagged links, their traffic, and what converts"
      range={range}
      from={from}
      to={to}
      showFilter={false}
      meta="sessions, last 12 months"
    >
      <Section title="Reach" aside="every session, tagged or not">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Stat
            label="Live campaigns"
            value={num(live.length)}
            note={
              ended.length > 0 ? `${num(ended.length)} ended` : 'none ended'
            }
          />
          <Stat
            label="Campaign sessions"
            value={num(totals.tagged)}
            note={`of ${num(totals.total)} total`}
          />
          <Stat
            label="Tagged share"
            value={`${taggedShare.toFixed(2)}%`}
            note="traffic a campaign can be credited for"
          />
          <Stat
            label="Orders from campaigns"
            value={num(campaignOrders)}
            note="clicks are not sales"
          />
        </div>
      </Section>

      {/* ── Live ─────────────────────────────────────────────────────── */}

      <Section
        title="Live campaigns"
        aside="traffic this month or last"
      >
        {live.length === 0 ? (
          <Empty>
            No campaign has been clicked in the last two months. A tagged link
            that nobody follows looks identical to one that was never sent.
          </Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Campaign</th>
                <th className="py-2 pr-4 text-left font-normal">Source</th>
                <th className="py-2 pr-4 text-right font-normal">Sessions</th>
                <th className="py-2 pr-4 text-right font-normal">Recent</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 pr-4 text-right font-normal">Revenue</th>
                <th className="py-2 text-left font-normal">Running</th>
              </>
            }
          >
            {live.map((c) => (
              <Row key={`${c.utm_campaign}-${c.utm_source}`}>
                <td className="py-2 pr-4">{c.utm_campaign}</td>
                <td className="py-2 pr-4 text-muted">
                  {[c.utm_source, c.utm_medium].filter(Boolean).join(' · ')}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.sessions))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.sessions_recent ?? 0))}
                </td>
                <td
                  className={`numeric py-2 pr-4 text-right ${
                    Number(c.orders) === 0 ? 'text-danger' : ''
                  }`}
                >
                  {num(Number(c.orders))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {Number(c.revenue) > 0 ? money(Number(c.revenue)) : '—'}
                </td>
                <td className="py-2 text-xs text-muted">
                  {monthLabel(c.first_month)}
                  {c.first_month !== c.last_month &&
                    ` — ${monthLabel(c.last_month)}`}
                </td>
              </Row>
            ))}
          </Table>
        )}

        {live.length > 0 && campaignOrders === 0 && (
          <p className="max-w-3xl border-l-2 border-danger pl-4 text-sm text-muted">
            Every campaign session so far has ended without an order. At these
            volumes that is not yet evidence the links do not work — it is too
            few clicks to conclude anything either way. It becomes a finding
            when the click count grows and this column stays at zero.
          </p>
        )}
      </Section>

      {ended.length > 0 && (
        <Section title="Ended" aside="no traffic in the last two months">
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Campaign</th>
                <th className="py-2 pr-4 text-left font-normal">Source</th>
                <th className="py-2 pr-4 text-right font-normal">Sessions</th>
                <th className="py-2 text-left font-normal">Ran</th>
              </>
            }
          >
            {ended.map((c) => (
              <Row key={`${c.utm_campaign}-${c.utm_source}`}>
                <td className="py-2 pr-4 text-muted">{c.utm_campaign}</td>
                <td className="py-2 pr-4 text-muted">
                  {[c.utm_source, c.utm_medium].filter(Boolean).join(' · ')}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.sessions))}
                </td>
                <td className="py-2 text-xs text-muted">
                  {monthLabel(c.first_month)} — {monthLabel(c.last_month)}
                </td>
              </Row>
            ))}
          </Table>
        </Section>
      )}

      {/* ── The denominator ──────────────────────────────────────────── */}

      <Section
        title="How much traffic can be credited"
        aside="tagged vs untagged, by month"
      >
        {tagging.length === 0 ? (
          <Empty>No session series yet. Run a Shopify sync.</Empty>
        ) : (
          <div className="space-y-1">
            {tagging.slice(0, 12).map((t) => (
              <Bar
                key={t.month}
                label={monthLabel(t.month)}
                value={Number(t.total ?? 0)}
                max={maxMonth}
                display={num(Number(t.total ?? 0))}
                sub={
                  Number(t.tagged ?? 0) > 0
                    ? `${num(Number(t.tagged))} tagged`
                    : 'none tagged'
                }
              />
            ))}
          </div>
        )}
        <p className="max-w-3xl text-sm text-muted">
          {pct(taggedShare)} of sessions arrive on a link that names a
          campaign. The rest is real traffic that no campaign can be credited
          for — not missing data, but unattributable by construction. Tagging
          a link costs nothing and is the only way that changes.
        </p>
      </Section>

      {/* ── Links that cannot be measured ────────────────────────────── */}

      {untrackedLanding.length > 0 && (
        <Section
          title="Untagged landing pages"
          aside="last 30 days"
        >
          <p className="max-w-3xl text-sm text-muted">
            These pages get campaign traffic but cannot report it. The VIP
            loyalty link points at{' '}
            <code>/account/register</code> with no <code>utm_</code>{' '}
            parameters, so its clicks are indistinguishable from anyone using
            the &ldquo;create account&rdquo; button in the header. Shopify
            also strips the query string from a landing path, so the{' '}
            <code>checkout_url</code> that names the collection never
            survives.
          </p>
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Landing page</th>
                <th className="py-2 text-right font-normal">Sessions</th>
              </>
            }
          >
            {untrackedLanding.map((l) => (
              <Row key={l.landing_path}>
                <td className="numeric py-2 pr-4 text-xs">{l.landing_path}</td>
                <td className="numeric py-2 text-right">
                  {num(Number(l.sessions))}
                </td>
              </Row>
            ))}
          </Table>
          <p className="max-w-3xl text-sm text-muted">
            Fix by tagging the link the way the outreach link already is:
            <br />
            <code className="mt-1 inline-block break-all text-xs">
              /account/register?utm_source=bdr&amp;utm_medium=outreach&amp;utm_campaign=vip-loyalty-2026&amp;checkout_url=/collections/vip-loyalty-program
            </code>
            <br />
            It appears here automatically from the next click. It cannot
            recover the clicks already made.
          </p>
        </Section>
      )}
    </Shell>
  )
}
