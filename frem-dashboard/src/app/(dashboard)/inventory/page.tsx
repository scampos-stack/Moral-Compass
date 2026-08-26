import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { readRange, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

/**
 * Stock on hand, what to reorder, and what the catalogue has been typed
 * wrong.
 *
 * No date filter. Every other section answers "what happened in a window";
 * this one answers "what is on the shelf right now", and a range picker
 * over a snapshot would imply history the table does not have.
 */

type Alert = {
  variant_id: number
  product_title: string | null
  variant_title: string | null
  sku: string | null
  available: number
  units_60d: number
  cover_days: number | null
  last_sold_at: string | null
  severity: string
  rank: number
  price: number
}

type Naming = {
  scope: string
  norm_key: string
  spellings: number
  variants_seen: string[]
  affected_variants: number
}

type DupSku = {
  sku_key: string
  variants: number
  units: number
  spellings: string[]
  products: string[]
}

/** Days since a timestamp, for "last sold" — null when it never sold. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()

  const [alertRes, namingRes, dupRes, allRes] = await Promise.all([
    supabase.from('v_inventory_alerts').select('*').limit(500),
    supabase.from('v_naming_issues').select('*').limit(200),
    supabase.from('v_duplicate_skus').select('*').limit(100),
    supabase
      .from('shopify_inventory')
      .select('available, product_status, inventory_management')
      .eq('product_status', 'active')
      .limit(20000),
  ])

  // The table has not been created or synced yet. Say so plainly rather than
  // rendering a page of zeros that looks like a healthy, empty catalogue.
  const missing = Boolean(alertRes.error) || (allRes.data ?? []).length === 0

  const alerts = (alertRes.data ?? []) as Alert[]
  const naming = (namingRes.data ?? []) as Naming[]
  const dupes = (dupRes.data ?? []) as DupSku[]
  const all = (allRes.data ?? []) as Array<{
    available: number
    inventory_management: string | null
  }>

  const tracked = all.filter((r) => r.inventory_management === 'shopify')
  const onHand = tracked.reduce((a, r) => a + Math.max(r.available, 0), 0)

  // "Needs attention" is everything a buyer would act on this week. The two
  // idle buckets are excluded on purpose: a line that has not sold in sixty
  // days is a discontinuation decision, not a reorder.
  const actionable = alerts.filter(
    (a) => a.severity !== 'Out - no recent sales' && a.severity !== 'Watch'
  )
  const namingAffected = naming.reduce((a, n) => a + n.affected_variants, 0)

  const bySeverity = new Map<string, Alert[]>()
  for (const a of alerts) {
    if (!bySeverity.has(a.severity)) bySeverity.set(a.severity, [])
    bySeverity.get(a.severity)!.push(a)
  }

  return (
    <Shell
      title="Inventory"
      subtitle="Stock on hand, reorder alerts, and catalogue hygiene"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      {missing ? (
        <Empty>
          No inventory synced yet. Apply{' '}
          <code>supabase/migrations/0016_inventory.sql</code>, then run the
          Inventory sync from the Data page.
        </Empty>
      ) : (
        <>
          <Section title="On hand" aside="Active, Shopify-tracked variants">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <Stat
                label="Units in stock"
                value={num(onHand)}
                note={`${num(tracked.length)} tracked variants`}
              />
              <Stat
                label="Needs reorder"
                value={num(actionable.length)}
                note="Oversold, out while selling, critical, or low"
              />
              <Stat
                label="Out of stock"
                value={num(
                  alerts.filter((a) => a.available <= 0).length
                )}
                note={`${num(
                  bySeverity.get('Out - still selling')?.length ?? 0
                )} still selling`}
              />
              <Stat
                label="Naming warnings"
                value={num(naming.length + dupes.length)}
                note={`${num(namingAffected)} variants affected`}
              />
            </div>
          </Section>

          {/* ── Reorder ──────────────────────────────────────────────── */}

          <Section
            title="Reorder now"
            aside="Ordered by urgency, not by how empty the shelf is"
          >
            {actionable.length === 0 ? (
              <Empty>Nothing needs reordering. Every active line has cover.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th className="py-2 pr-3 text-left font-normal">Product</th>
                    <th className="py-2 pr-3 text-left font-normal">SKU</th>
                    <th className="py-2 pr-3 text-left font-normal">Alert</th>
                    <th className="py-2 pr-3 text-right font-normal">On hand</th>
                    <th className="py-2 pr-3 text-right font-normal">Sold 60d</th>
                    <th className="py-2 pr-3 text-right font-normal">Cover</th>
                    <th className="py-2 text-right font-normal">Last sold</th>
                  </>
                }
              >
                {actionable.slice(0, 100).map((a) => {
                  const d = daysSince(a.last_sold_at)
                  return (
                    <Row key={a.variant_id}>
                      <td className="max-w-xs py-2 pr-3">
                        <span className="block truncate" title={a.product_title ?? ''}>
                          {a.product_title ?? '—'}
                        </span>
                        {a.variant_title && a.variant_title !== 'Default Title' && (
                          <span className="block truncate text-xs text-muted">
                            {a.variant_title}
                          </span>
                        )}
                      </td>
                      <td className="numeric py-2 pr-3 text-xs">{a.sku ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={
                            a.rank <= 2 ? 'text-danger' : 'text-foreground'
                          }
                        >
                          {a.severity}
                        </span>
                      </td>
                      <td className="numeric py-2 pr-3 text-right">
                        {num(a.available)}
                      </td>
                      <td className="numeric py-2 pr-3 text-right">
                        {num(a.units_60d)}
                      </td>
                      <td className="numeric py-2 pr-3 text-right">
                        {a.cover_days === null ? '—' : `${a.cover_days}d`}
                      </td>
                      <td className="numeric py-2 text-right text-muted">
                        {d === null ? 'never' : `${d}d ago`}
                      </td>
                    </Row>
                  )
                })}
              </Table>
            )}
            {actionable.length > 100 && (
              <p className="text-xs text-muted">
                Showing the 100 most urgent of {num(actionable.length)}.
              </p>
            )}
          </Section>

          {/* ── The typing mess ──────────────────────────────────────── */}

          <Section
            title="Naming warnings"
            aside="The same value typed more than one way"
          >
            <p className="max-w-3xl text-sm text-muted">
              Each row is one thing that has been entered in several different
              spellings — <em>Pink</em> and <em>PINK</em> are two rows in
              Shopify but one colour on the shelf. Left alone, stock for that
              colour splits across both and neither count is right. Fix by
              editing every listed spelling to a single form.
            </p>
            {naming.length === 0 ? (
              <Empty>No inconsistent spellings. The catalogue is clean.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th className="py-2 pr-3 text-left font-normal">Where</th>
                    <th className="py-2 pr-3 text-left font-normal">
                      Typed as
                    </th>
                    <th className="py-2 pr-3 text-right font-normal">
                      Spellings
                    </th>
                    <th className="py-2 text-right font-normal">Variants</th>
                  </>
                }
              >
                {naming.slice(0, 60).map((n) => (
                  <Row key={`${n.scope}-${n.norm_key}`}>
                    <td className="whitespace-nowrap py-2 pr-3 text-muted">
                      {n.scope}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="flex flex-wrap gap-1.5">
                        {n.variants_seen.map((v) => (
                          <code
                            key={v}
                            className="border border-border px-1.5 py-0.5 text-xs"
                          >
                            {v}
                          </code>
                        ))}
                      </span>
                    </td>
                    <td className="numeric py-2 pr-3 text-right text-danger">
                      {n.spellings}
                    </td>
                    <td className="numeric py-2 text-right">
                      {num(n.affected_variants)}
                    </td>
                  </Row>
                ))}
              </Table>
            )}
            {naming.length > 60 && (
              <p className="text-xs text-muted">
                Showing 60 of {num(naming.length)}, worst first.
              </p>
            )}
          </Section>

          {/* ── SKU collisions ───────────────────────────────────────── */}

          <Section
            title="Duplicate SKUs"
            aside="One code, several different products"
          >
            <p className="max-w-3xl text-sm text-muted">
              Different variants sharing a SKU. This is the one that breaks a
              two-store rollup: if a code is not unique inside one store,
              matching it against a second store merges products that are not
              the same thing.
            </p>
            {dupes.length === 0 ? (
              <Empty>Every SKU is unique.</Empty>
            ) : (
              <Table
                head={
                  <>
                    <th className="py-2 pr-3 text-left font-normal">SKU</th>
                    <th className="py-2 pr-3 text-left font-normal">
                      Products sharing it
                    </th>
                    <th className="py-2 pr-3 text-right font-normal">
                      Variants
                    </th>
                    <th className="py-2 text-right font-normal">Units</th>
                  </>
                }
              >
                {dupes.slice(0, 40).map((d) => (
                  <Row key={d.sku_key}>
                    <td className="numeric py-2 pr-3 text-xs">
                      {d.spellings.join(' / ')}
                    </td>
                    <td className="max-w-md py-2 pr-3 text-xs text-muted">
                      <span className="block truncate" title={d.products.join(' · ')}>
                        {d.products.join(' · ')}
                      </span>
                    </td>
                    <td className="numeric py-2 pr-3 text-right text-danger">
                      {d.variants}
                    </td>
                    <td className="numeric py-2 text-right">{num(d.units)}</td>
                  </Row>
                ))}
              </Table>
            )}
            {dupes.length > 40 && (
              <p className="text-xs text-muted">
                Showing 40 of {num(dupes.length)}.
              </p>
            )}
          </Section>

          <Section title="What these numbers do not cover">
            <ul className="max-w-3xl list-disc space-y-1 pl-5 text-sm text-muted">
              <li>
                One store only. Lila Haven needs its own Shopify app
                credentials before anything can be consolidated.
              </li>
              <li>
                Sales velocity uses a 60-day window — all Shopify returns
                without the <code>read_all_orders</code> scope. Enough for a
                rate, not enough for seasonality.
              </li>
              <li>
                Velocity counts Faire orders as well as direct. A unit shipped
                through the marketplace leaves the shelf too.
              </li>
              <li>
                Archived and draft products are excluded from every alert, and
                variants with tracking switched off are excluded from stock —
                their quantity is always zero and would read as a stockout.
              </li>
            </ul>
          </Section>
        </>
      )}
    </Shell>
  )
}
