import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty, Bar } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { readRange, money0, money, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

/**
 * Buckets a direct order by where the buyer came from.
 *
 * "Attributed" here means anything traceable to our own channels: a UTM-tagged
 * campaign link, a social referrer, or an external site. Traffic that lands on
 * "/" with no referrer is genuinely unattributable — calling it "direct" would
 * dress up an absence of data as a channel.
 */
function attributeOrder(o: {
  utm_source: string | null
  utm_campaign: string | null
  referring_site: string | null
  landing_site: string | null
}) {
  if (o.utm_campaign) return `Campaign: ${o.utm_campaign}`
  if (o.utm_source) return `UTM: ${o.utm_source}`
  if (o.referring_site) {
    try {
      const h = new URL(o.referring_site).hostname.replace(/^www\./, '')
      const social =
        /instagram|facebook|tiktok|pinterest|linkedin|t\.co|twitter/i.test(h)
      return social ? `Social: ${h}` : `Referral: ${h}`
    } catch {
      return 'Referral: unknown'
    }
  }
  return 'Untracked'
}

export default async function ShopifyPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to, window } = await readRange(searchParams)
  const supabase = createReadClient()

  let ordersQ = supabase
    .from('shopify_orders')
    .select(
      'id, name, total_price, placed_at, is_direct_sale, is_faire_mirror, utm_source, utm_medium, utm_campaign, referring_site, landing_site, email, customer_name'
    )
    .eq('test', false)
    .is('cancelled_at', null)
  if (window.from) ordersQ = ordersQ.gte('placed_at', window.from)
  if (window.to) ordersQ = ordersQ.lt('placed_at', window.to)

  const [ordersRes, collRes, prodRes, sessRes] = await Promise.all([
    ordersQ.limit(20000),
    supabase.from('v_collection_sales').select('*').limit(25),
    supabase.from('v_product_sales').select('*').limit(15),
    supabase
      .from('shopify_sessions')
      .select(
        'utm_source, utm_medium, utm_campaign, referrer_name, referrer_source, landing_path, sessions'
      )
      .eq('window_days', 30)
      .order('sessions', { ascending: false })
      .limit(200),
  ])

  const sessionRows = (sessRes.data ?? []) as Array<{
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    referrer_name: string | null
    referrer_source: string | null
    landing_path: string | null
    sessions: number
  }>

  // The three groupings each cover all traffic, so they are kept apart —
  // combining them would count the same session up to three times.
  const utmRows = sessionRows.filter((r) => r.utm_source || r.utm_campaign)
  const refRows = sessionRows.filter(
    (r) => r.referrer_name !== null || r.referrer_source !== null
  )
  const pathRows = sessionRows.filter((r) => r.landing_path !== null)

  const totalSessions = refRows.reduce((a, r) => a + Number(r.sessions), 0)
  const taggedSessions = utmRows.reduce((a, r) => a + Number(r.sessions), 0)
  const maxUtm = Math.max(...utmRows.map((r) => Number(r.sessions)), 0)
  const maxRef = Math.max(...refRows.map((r) => Number(r.sessions)), 0)

  const orders = (ordersRes.data ?? []) as Array<{
    id: number
    name: string | null
    total_price: number
    placed_at: string
    is_direct_sale: boolean
    is_faire_mirror: boolean
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    referring_site: string | null
    landing_site: string | null
    email: string | null
    customer_name: string | null
  }>

  const collections = (collRes.data ?? []) as Array<{
    collection: string
    kind: string
    orders: number
    units: number
    revenue: number
    direct_orders: number
    direct_revenue: number
  }>

  const products = (prodRes.data ?? []) as Array<{
    title: string
    orders: number
    units: number
    revenue: number
  }>

  const direct = orders.filter((o) => o.is_direct_sale)
  const mirrored = orders.filter((o) => o.is_faire_mirror)

  const directRevenue = direct.reduce((s, o) => s + Number(o.total_price), 0)
  const mirroredRevenue = mirrored.reduce(
    (s, o) => s + Number(o.total_price),
    0
  )

  // Attribution buckets across direct sales only — a Faire mirror has no
  // Shopify traffic source to speak of.
  const buckets = new Map<string, { orders: number; revenue: number }>()
  for (const o of direct) {
    const k = attributeOrder(o)
    const e = buckets.get(k) ?? { orders: 0, revenue: 0 }
    e.orders += 1
    e.revenue += Number(o.total_price)
    buckets.set(k, e)
  }
  const attributed = [...buckets.entries()].sort(
    (a, b) => b[1].revenue - a[1].revenue
  )
  const maxAttr = Math.max(...attributed.map(([, v]) => v.revenue), 0)
  const untracked = buckets.get('Untracked')?.orders ?? 0

  const maxColl = Math.max(...collections.map((c) => Number(c.revenue)), 0)

  return (
    <Shell
      title="Shopify"
      subtitle="The owned channel — direct sales, collections, campaign links"
      range={range}
      from={from}
      to={to}
      meta={`${num(direct.length)} direct of ${num(orders.length)}`}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Direct revenue"
          value={money0(directRevenue)}
          note={`${num(direct.length)} orders, 0% fee`}
        />
        <Stat
          label="Commission avoided"
          value={money0(directRevenue * 0.15)}
          note="vs 15% on Faire"
        />
        <Stat
          label="Faire mirrored"
          value={money0(mirroredRevenue)}
          note={`${num(mirrored.length)} orders — not direct`}
        />
        <Stat
          label="Average order"
          value={direct.length > 0 ? money0(directRevenue / direct.length) : '—'}
          note="direct only"
        />
      </section>

      <div className="border-l-2 border-foreground pl-4">
        <p className="text-sm font-medium">
          Faire mirrors every marketplace order into Shopify
        </p>
        <p className="mt-1 text-sm text-muted">
          {num(mirrored.length)} of these {num(orders.length)} orders arrived
          tagged &ldquo;Faire, Wholesale&rdquo;. They are marketplace sales
          appearing in Shopify, not owned-channel revenue, and every figure on
          this page excludes them. Counting them would double the business and
          report Faire as the channel you own.
        </p>
      </div>

      <Section
        title="Where direct sales came from"
        aside="UTM link, referrer, or untracked"
      >
        {attributed.length === 0 ? (
          <Empty>No direct sales in this range.</Empty>
        ) : (
          <>
            <div>
              {attributed.map(([label, v]) => (
                <Bar
                  key={label}
                  label={label}
                  value={v.revenue}
                  max={maxAttr}
                  display={money(v.revenue)}
                  sub={`${num(v.orders)} order${v.orders === 1 ? '' : 's'}`}
                />
              ))}
            </div>
            {untracked > 0 && (
              <p className="text-xs text-muted">
                {num(untracked)} order{untracked === 1 ? '' : 's'} arrived with
                no UTM and no referrer — landing straight on the homepage. If
                you are sending campaign links, their tracking is not reaching
                Shopify. Tag them as{' '}
                <span className="numeric">
                  ?utm_source=faire&amp;utm_campaign=back-to-school
                </span>{' '}
                and this panel fills in.
              </p>
            )}
          </>
        )}
      </Section>

      {/* ── Traffic ────────────────────────────────────────────────────── */}
      <Section
        title="Link clicks by campaign"
        aside="last 30 days · sessions, not orders"
      >
        {utmRows.length === 0 ? (
          <Empty>
            No tagged links clicked in the last 30 days. Run a Shopify sync, or
            add utm_ parameters to your campaign links.
          </Empty>
        ) : (
          <>
            <div>
              {utmRows.slice(0, 12).map((r, i) => (
                <Bar
                  key={`${r.utm_source}-${r.utm_medium}-${r.utm_campaign}-${i}`}
                  label={
                    r.utm_campaign ??
                    [r.utm_source, r.utm_medium].filter(Boolean).join(' · ')
                  }
                  value={Number(r.sessions)}
                  max={maxUtm}
                  display={num(Number(r.sessions))}
                  sub={r.utm_campaign ? (r.utm_source ?? undefined) : undefined}
                />
              ))}
            </div>
            <p className="text-xs text-muted">
              {num(taggedSessions)} of {num(totalSessions)} sessions arrived on
              a tagged link. These are clicks — Shopify can group sessions by
              campaign but not sales, so revenue per link is only knowable when
              a tagged visitor actually orders.
            </p>
          </>
        )}
      </Section>

      <Section title="Traffic by referrer" aside="last 30 days">
        {refRows.length === 0 ? (
          <Empty>No session data. Run a Shopify sync.</Empty>
        ) : (
          <div>
            {refRows.slice(0, 12).map((r, i) => (
              <Bar
                key={`${r.referrer_name}-${r.referrer_source}-${i}`}
                label={
                  r.referrer_name ?? r.referrer_source ?? 'direct / untagged'
                }
                value={Number(r.sessions)}
                max={maxRef}
                display={num(Number(r.sessions))}
                sub={r.referrer_name ? (r.referrer_source ?? undefined) : undefined}
              />
            ))}
          </div>
        )}
      </Section>

      {pathRows.length > 0 && (
        <Section title="Where links land" aside="most-visited pages, 30 days">
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Page</th>
                <th className="py-2 text-right font-normal">Sessions</th>
              </>
            }
          >
            {pathRows.slice(0, 12).map((r, i) => (
              <Row key={`${r.landing_path}-${i}`}>
                <td className="max-w-lg truncate py-2 pr-4">
                  {r.landing_path}
                </td>
                <td className="numeric py-2 text-right">
                  {num(Number(r.sessions))}
                </td>
              </Row>
            ))}
          </Table>
        </Section>
      )}

      <Section
        title="Sales by collection"
        aside="all Shopify orders — what sells, regardless of channel"
      >
        {collections.length === 0 ? (
          <Empty>
            No collection data yet. Run a Shopify sync — collections are pulled
            alongside orders.
          </Empty>
        ) : (
          <>
            <div>
              {collections.slice(0, 12).map((c) => (
                <Bar
                  key={c.collection}
                  label={c.collection}
                  value={Number(c.revenue)}
                  max={maxColl}
                  display={money0(Number(c.revenue))}
                  sub={`${num(Number(c.units))} units`}
                />
              ))}
            </div>
            <p className="text-xs text-muted">
              A product can belong to several collections, so these rows
              overlap and do not sum to total revenue. Includes Faire-mirrored
              orders on purpose — what sells is a product question, not a
              channel question.
            </p>
          </>
        )}
      </Section>

      <Section title="Top products" aside="by revenue, all channels">
        {products.length === 0 ? (
          <Empty>No line-item data yet. Run a Shopify sync.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Product</th>
                <th className="py-2 pr-4 text-right font-normal">Units</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 text-right font-normal">Revenue</th>
              </>
            }
          >
            {products.map((p) => (
              <Row key={p.title}>
                <td className="max-w-md truncate py-2 pr-4">{p.title}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.units))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.orders))}
                </td>
                <td className="numeric py-2 text-right">
                  {money0(Number(p.revenue))}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Direct orders" aside="the owned-channel sales themselves">
        {direct.length === 0 ? (
          <Empty>No direct sales in this range.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Order</th>
                <th className="py-2 pr-4 text-left font-normal">Date</th>
                <th className="py-2 pr-4 text-left font-normal">Customer</th>
                <th className="py-2 pr-4 text-left font-normal">Source</th>
                <th className="py-2 text-right font-normal">Total</th>
              </>
            }
          >
            {direct.slice(0, 25).map((o) => (
              <Row key={o.id}>
                <td className="numeric py-2 pr-4">{o.name}</td>
                <td className="numeric py-2 pr-4 text-muted">
                  {o.placed_at.slice(0, 10)}
                </td>
                <td className="py-2 pr-4">
                  {o.customer_name ?? o.email ?? '—'}
                </td>
                <td className="py-2 pr-4 text-muted">{attributeOrder(o)}</td>
                <td className="numeric py-2 text-right">
                  {money(Number(o.total_price))}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
