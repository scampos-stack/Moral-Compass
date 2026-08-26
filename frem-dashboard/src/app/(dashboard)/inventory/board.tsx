'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  markOrdered,
  markReceived,
  clearReorder,
  type ActionState,
} from './actions'
import { OrderLog } from './order-log'
import { toCsv, download, stamp } from './csv'
import { ACTIONABLE } from './severity'
import { NamingTableRow } from './naming-row'

export type ReorderState = {
  status: 'ordered' | 'received'
  ordered_qty: number | null
  ordered_at: string | null
  received_at: string | null
  actor: string
  expected_at: string | null
  po_number: string | null
  /** Units on hand when the order was placed, for detecting an arrival. */
  available_at_order: number | null
  /** available − available_at_order. Positive means the shelf grew. */
  stock_delta: number | null
  /** Days past expected_at. Null when no date was given. */
  days_late: number | null
}

export type Row = {
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
  state: ReorderState | null
  /** Set when this variant's SKU is shared and a sibling still holds stock. */
  masked: { sku_total: number; sharing: number } | null
}

export type NamingRow = {
  scope: string
  norm_key: string
  spellings: number
  variants_seen: string[]
  affected_variants: number
  claim: { actor: string; claimed_at: string } | null
}

const num = (n: number) => n.toLocaleString('en-US')

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

const ago = (iso: string | null) => {
  const d = daysSince(iso)
  if (d === null) return ''
  return d === 0 ? 'today' : `${d}d ago`
}

/**
 * Buying board.
 *
 * Reorder and naming sit side by side and each scrolls inside itself, so
 * both headline numbers are visible in one screenful and the page height
 * does not grow with the row count. Seeing that a cleanup backlog exists at
 * the same time as the buying list is the entire point; stacking them meant
 * scrolling past 261 rows to discover the second one.
 *
 * Either panel expands to the full width when a single list is the job, and
 * both export to CSV for anyone who would rather work in a spreadsheet.
 */
export function Board({
  rows,
  naming,
  fixedSinceClaim,
  unlocked,
}: {
  rows: Row[]
  naming: NamingRow[]
  fixedSinceClaim: number
  unlocked: boolean
}) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'open' | 'ordered' | 'masked' | 'idle'>('open')
  const [focus, setFocus] = useState<'none' | 'reorder' | 'naming'>('none')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<ActionState>(null)

  const run = (
    fn: (prev: ActionState, fd: FormData) => Promise<ActionState>,
    fd: FormData
  ) => {
    start(async () => setMsg(await fn(null, fd)))
  }

  // One search box drives both panels. A buyer checking a product wants to
  // know its stock AND whether its name is part of the mess — splitting that
  // across two search boxes would hide exactly the connection that matters.
  const q = query.trim().toLowerCase()
  const match = (...fields: (string | null | undefined)[]) =>
    !q || fields.some((f) => (f ?? '').toLowerCase().includes(q))

  const buckets = useMemo(() => {
    const open: Row[] = []
    const ordered: Row[] = []
    const masked: Row[] = []
    const idle: Row[] = []
    for (const r of rows) {
      // "Received but still low" deliberately returns to the open list. The
      // order was closed and the shelf is still empty, which is a fact the
      // buyer needs, not a closed ticket.
      if (r.state?.status === 'ordered') ordered.push(r)
      else if (ACTIONABLE.has(r.severity)) open.push(r)
      else idle.push(r)
      if (r.masked) masked.push(r)
    }
    return { open, ordered, masked, idle }
  }, [rows])

  const visible = buckets[tab].filter((r) =>
    match(r.product_title, r.variant_title, r.sku)
  )
  const visibleNaming = naming.filter((n) =>
    match(n.norm_key, ...n.variants_seen)
  )

  const TABS = [
    { id: 'open', label: 'Needs decision', n: buckets.open.length },
    { id: 'ordered', label: 'On order', n: buckets.ordered.length },
    { id: 'masked', label: 'Stock hiding', n: buckets.masked.length },
    { id: 'idle', label: 'Idle / discontinue', n: buckets.idle.length },
  ] as const

  const exportReorder = () => {
    download(
      `frem-reorder-${tab}-${stamp()}.csv`,
      toCsv(
        [
          'SKU',
          'Product',
          'Variant',
          'Alert',
          'On hand',
          'Sold 60d',
          'Cover days',
          'Last sold',
          'Status',
          'Ordered qty',
          'Ordered by',
          'Ordered at',
          'PO number',
          'Expected at',
          'Days late',
          'Stock since order',
          'Stock hiding',
        ],
        visible.map((r) => [
          r.sku,
          r.product_title,
          r.variant_title,
          r.severity,
          r.available,
          r.units_60d,
          r.cover_days,
          r.last_sold_at?.slice(0, 10) ?? '',
          r.state?.status ?? 'open',
          r.state?.ordered_qty ?? '',
          r.state?.actor ?? '',
          r.state?.ordered_at?.slice(0, 10) ?? '',
          r.state?.po_number ?? '',
          r.state?.expected_at ?? '',
          r.state?.days_late != null && r.state.days_late > 0
            ? r.state.days_late
            : '',
          r.state?.stock_delta ?? '',
          r.masked ? `${r.masked.sku_total} units on ${r.masked.sharing} variants` : '',
        ])
      )
    )
  }

  const exportNaming = () => {
    download(
      `frem-naming-warnings-${stamp()}.csv`,
      toCsv(
        ['Where', 'Normalised value', 'Spellings', 'Variants affected', 'Typed as', 'Claimed by', 'Claimed at'],
        visibleNaming.map((n) => [
          n.scope,
          n.norm_key,
          n.spellings,
          n.affected_variants,
          n.variants_seen.join(' | '),
          n.claim?.actor ?? '',
          n.claim?.claimed_at?.slice(0, 10) ?? '',
        ])
      )
    )
  }

  const showReorder = focus !== 'naming'
  const showNaming = focus !== 'reorder'

  // Both panels must be readable in one screenful — the whole point is to see
  // at a glance that there is a reorder list AND a cleanup backlog. So they
  // sit side by side and each scrolls inside itself; the page itself does not
  // grow with the row count. Expanding one gives it the full width and a
  // taller window, for when a single list is the job.
  const listMax =
    focus === 'none'
      ? 'max-h-[52vh] overflow-y-auto'
      : 'max-h-[72vh] overflow-y-auto'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, SKU or colour…"
          aria-label="Search inventory"
          className="w-full max-w-sm border border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-foreground"
        />
        {q && (
          <span className="text-xs text-muted">
            {num(visible.length)} in this tab · {num(visibleNaming.length)}{' '}
            naming
          </span>
        )}
        {msg && (
          <span
            role="status"
            className={`text-xs ${msg.ok ? 'text-muted' : 'text-danger'}`}
          >
            {msg.message}
          </span>
        )}
      </div>

      {/* ── Reorder ──────────────────────────────────────────────────── */}

      <div className={focus === 'none' ? 'grid items-start gap-6 xl:grid-cols-2' : 'space-y-6'}>
      {showReorder && (
        <section className="min-w-0 space-y-3">
          <PanelBar
            title="Reorder"
            count={visible.length}
            focused={focus === 'reorder'}
            onFocus={() =>
              setFocus(focus === 'reorder' ? 'none' : 'reorder')
            }
            onExport={exportReorder}
            exportLabel="Download this tab as CSV"
          />

          <OrderLog rows={buckets.ordered} />

          <div className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  '-mb-px border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors ' +
                  (tab === t.id
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted hover:text-foreground')
                }
              >
                {t.label}
                <span className="numeric ml-2">{num(t.n)}</span>
              </button>
            ))}
          </div>

          {tab === 'idle' && (
            <p className="max-w-3xl text-xs text-muted">
              Out of stock with nothing sold in sixty days. These are
              discontinuation calls rather than reorders, which is why they
              are kept out of the main list.
            </p>
          )}

          {visible.length === 0 ? (
            <p className="border border-dashed border-border px-4 py-6 text-sm text-muted">
              {q ? 'Nothing matches that search.' : 'Nothing here.'}
            </p>
          ) : (
            <ul className={`divide-y divide-border border-y border-border ${listMax}`}>
              {visible.slice(0, 150).map((r) => (
                <ReorderRow
                  key={r.variant_id}
                  row={r}
                  unlocked={unlocked}
                  pending={pending}
                  run={run}
                />
              ))}
            </ul>
          )}
          {visible.length > 150 && (
            <p className="text-xs text-muted">
              Showing 150 of {num(visible.length)}. Search to narrow, or export
              the full {num(visible.length)} to CSV.
            </p>
          )}
        </section>
      )}

      {/* ── Naming ───────────────────────────────────────────────────── */}

      {showNaming && (
        <section className="min-w-0 space-y-3">
          <PanelBar
            title="Naming warnings"
            count={visibleNaming.length}
            focused={focus === 'naming'}
            onFocus={() => setFocus(focus === 'naming' ? 'none' : 'naming')}
            onExport={exportNaming}
            exportLabel="Download warnings as CSV"
          />

          <p className="max-w-4xl text-xs text-muted">
            Claiming does not close a row. The list is rebuilt from Shopify on
            every sync, so anything still typed two ways comes back — showing
            who took it and when. Open a row to see the exact SKUs to fix.
            {fixedSinceClaim > 0 && (
              <span className="text-foreground">
                {' '}
                {num(fixedSinceClaim)} fixed so far.
              </span>
            )}
          </p>

          {visibleNaming.length === 0 ? (
            <p className="border border-dashed border-border px-4 py-6 text-sm text-muted">
              {q ? 'No naming issue matches.' : 'Catalogue is clean.'}
            </p>
          ) : (
            <div className={`overflow-x-auto border-y border-border ${listMax}`}>
              <table className="w-full border-collapse text-sm">
                {/* Sticky, because the panel scrolls inside itself now and a
                    header that scrolls away leaves seven unlabelled columns. */}
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
                    <th className="py-2 pr-4 text-left font-normal">Where</th>
                    <th className="py-2 pr-4 text-left font-normal">Typed as</th>
                    <th className="py-2 pr-4 text-right font-normal">
                      Spellings
                    </th>
                    <th className="py-2 pr-4 text-right font-normal">
                      Items affected
                    </th>
                    <th className="py-2 pr-4 text-left font-normal">Owner</th>
                    <th className="py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {visibleNaming.map((n) => (
                    <NamingTableRow
                      key={`${n.scope}-${n.norm_key}`}
                      row={n}
                      unlocked={unlocked}
                      pending={pending}
                      run={run}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      </div>
    </div>
  )
}

/* ── Panel chrome ────────────────────────────────────────────────────── */

/**
 * Title, count, expand and export for one panel.
 *
 * The expand control is a toggle rather than a modal: the other panel is
 * hidden, not covered, so nothing is left scrolling underneath.
 */
function PanelBar({
  title,
  count,
  focused,
  onFocus,
  onExport,
  exportLabel,
}: {
  title: string
  count: number
  focused: boolean
  onFocus: () => void
  onExport: () => void
  exportLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
      <h2 className="text-xs uppercase tracking-wider text-muted">
        {title}
        <span className="numeric ml-2 text-foreground">{num(count)}</span>
      </h2>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onExport}
          title={exportLabel}
          aria-label={exportLabel}
          className="border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
        >
          CSV
        </button>
        <button
          type="button"
          onClick={onFocus}
          aria-pressed={focused}
          title={focused ? 'Show both panels' : `Expand ${title}`}
          aria-label={focused ? 'Show both panels' : `Expand ${title}`}
          className="border border-border px-2 py-1 text-muted transition-colors hover:border-foreground hover:text-foreground"
        >
          {/* Diagonal arrows: out of the corners to expand, into them to
              restore. Drawn inline so the icon inherits currentColor in both
              themes without shipping an icon set. */}
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
            aria-hidden
          >
            {focused ? (
              <>
                <path d="M7 1v6H1M9 15V9h6" />
                <path d="M1 1l5.5 5.5M15 15L9.5 9.5" />
              </>
            ) : (
              <>
                <path d="M10 1h5v5M6 15H1v-5" />
                <path d="M15 1L9.5 6.5M1 15l5.5-5.5" />
              </>
            )}
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ── Rows ────────────────────────────────────────────────────────────── */

function ReorderRow({
  row: r,
  unlocked,
  pending,
  run,
}: {
  row: Row
  unlocked: boolean
  pending: boolean
  run: (
    fn: (prev: ActionState, fd: FormData) => Promise<ActionState>,
    fd: FormData
  ) => void
}) {
  // Suggests cover at the observed rate, falling back to a round dozen when
  // nothing has sold. A suggestion, not a decision — it is an editable field
  // precisely because the rate is only 60 days deep.
  const suggested = r.units_60d > 0 ? Math.max(r.units_60d, 6) : 12
  const [qty, setQty] = useState(String(suggested))
  // Default expected arrival: three weeks out. A date that is merely a guess
  // is still far better than none — it is what the late alert measures
  // against, and it can be edited before the order is recorded.
  const [expected, setExpected] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 21)
    return d.toISOString().slice(0, 10)
  })
  const [po, setPo] = useState('')

  const fd = (extra: Record<string, string> = {}) => {
    const f = new FormData()
    f.set('variant_id', String(r.variant_id))
    for (const [k, v] of Object.entries(extra)) f.set(k, v)
    return f
  }

  const urgent = r.rank <= 2

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={r.product_title ?? ''}>
            {r.product_title ?? '—'}
          </p>
          <p className="numeric truncate text-xs text-muted">
            {r.sku ?? 'no SKU'}
            {r.variant_title && r.variant_title !== 'Default Title' && (
              <span> · {r.variant_title}</span>
            )}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className={urgent ? 'text-danger' : 'text-foreground'}>
              {r.severity}
            </span>
            <span className="numeric text-muted">
              {num(r.available)} on hand
            </span>
            <span className="numeric text-muted">{num(r.units_60d)} sold 60d</span>
            {r.cover_days !== null && (
              <span className="numeric text-muted">{r.cover_days}d cover</span>
            )}
            <span className="text-muted">
              {r.last_sold_at ? `sold ${ago(r.last_sold_at)}` : 'never sold'}
            </span>
          </p>

          {/* The alert that stops a pointless order. */}
          {r.masked && (
            <p className="mt-1 border-l-2 border-danger pl-2 text-xs text-danger">
              Do not reorder yet — this SKU is on {r.masked.sharing} variants
              holding {num(r.masked.sku_total)} units between them. The shelf
              may be full under a different row.
            </p>
          )}

          {r.state?.status === 'received' && (
            <p className="mt-1 text-xs text-muted">
              Received {ago(r.state.received_at)} by {r.state.actor} — still
              below the line.
            </p>
          )}

          {r.state?.status === 'ordered' && (
            <div className="mt-1 space-y-1 text-xs">
              <p className="text-muted">
                {r.state.ordered_qty
                  ? `${num(r.state.ordered_qty)} ordered`
                  : 'Ordered'}{' '}
                {ago(r.state.ordered_at)} by {r.state.actor}
                {r.state.po_number && (
                  <span className="numeric"> · PO {r.state.po_number}</span>
                )}
                {r.state.expected_at && (
                  <span className="numeric">
                    {' '}
                    · due {r.state.expected_at}
                  </span>
                )}
              </p>

              {/* An order with no PO reference may never have actually been
                  placed with the supplier — someone recorded the intent and
                  moved on. Derived rather than stored as a status: it is
                  simply whether the field is empty, and a second source of
                  truth for that would only drift from the field itself. */}
              {!r.state.po_number && (
                <p className="text-danger">
                  No PO recorded — was this order actually placed?
                </p>
              )}

              {/* Arrival is inferred from the count rising above where it was
                  when the order was placed — never from an absolute level,
                  which misreads a returned unit as a delivery. Inference is
                  why this asks for confirmation instead of closing itself. */}
              {(r.state.stock_delta ?? 0) > 0 ? (
                <p className="text-foreground">
                  Stock rose {num(r.state.stock_delta ?? 0)} since ordering
                  {r.state.available_at_order !== null &&
                    ` (${num(r.state.available_at_order)} → ${num(r.available)})`}{' '}
                  — confirm it was this delivery.
                </p>
              ) : (
                r.state.days_late !== null &&
                r.state.days_late > 0 && (
                  <p className="text-danger">
                    {r.state.days_late}d past the expected date and nothing has
                    been registered. Stock is still {num(r.available)}.
                  </p>
                )
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!unlocked ? (
            <span className="text-xs text-muted">locked</span>
          ) : r.state?.status === 'ordered' ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markReceived, fd())}
                className="border border-border px-2.5 py-1.5 text-xs uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40"
              >
                Received
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(clearReorder, fd())}
                className="px-2 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                Undo
              </button>
            </>
          ) : (
            <>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-label={`Quantity to order for ${r.sku ?? r.variant_id}`}
                className="numeric w-16 border border-border bg-transparent px-2 py-1.5 text-right text-xs outline-none focus:border-foreground"
              />
              <input
                type="date"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                title="Expected arrival — leaves a date to chase against"
                aria-label={`Expected arrival for ${r.sku ?? r.variant_id}`}
                className="numeric w-32 border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-foreground"
              />
              <input
                type="text"
                value={po}
                onChange={(e) => setPo(e.target.value)}
                placeholder="PO #"
                title="Supplier order number, so this row can be matched to the paperwork"
                aria-label={`Purchase order number for ${r.sku ?? r.variant_id}`}
                className="numeric w-20 border border-border bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-foreground"
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(markOrdered, fd({ qty, expected_at: expected, po_number: po }))
                }
                className="bg-foreground px-2.5 py-1.5 text-xs uppercase tracking-wider text-background transition-opacity hover:opacity-80 disabled:opacity-40"
              >
                Ordered
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}
