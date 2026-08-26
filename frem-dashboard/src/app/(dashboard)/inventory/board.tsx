'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  markOrdered,
  markReceived,
  clearReorder,
  claimNaming,
  releaseNaming,
  namingItems,
  type ActionState,
  type NamingItem,
} from './actions'
import { OrderLog } from './order-log'
import { toCsv, download, stamp } from './csv'
import { ACTIONABLE } from './severity'

export type ReorderState = {
  status: 'ordered' | 'received'
  ordered_qty: number | null
  ordered_at: string | null
  received_at: string | null
  actor: string
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
 * Panels stack full width rather than sitting in columns. Both carry long
 * text — product titles, and every spelling of a colour — and a third of the
 * screen truncated most of it. Full width also lets the naming panel be a
 * real table with an expandable list of affected items, which is what the
 * person doing the renaming actually needs.
 *
 * Either panel can be expanded to fill the view when the other is in the
 * way, and both export to CSV for anyone who would rather work in a
 * spreadsheet.
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

      {showReorder && (
        <section className="space-y-3">
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
            <ul className="divide-y divide-border border-b border-border">
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
        <section className="space-y-3">
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
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
                    <th className="w-8 py-2" />
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
            <p className="mt-1 text-xs text-muted">
              {r.state.ordered_qty
                ? `${num(r.state.ordered_qty)} ordered`
                : 'Ordered'}{' '}
              {ago(r.state.ordered_at)} by {r.state.actor}
              {r.available > 5 && (
                <span className="text-foreground"> · stock has arrived</span>
              )}
            </p>
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
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markOrdered, fd({ qty }))}
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

function NamingTableRow({
  row: n,
  unlocked,
  pending,
  run,
}: {
  row: NamingRow
  unlocked: boolean
  pending: boolean
  run: (
    fn: (prev: ActionState, fd: FormData) => Promise<ActionState>,
    fd: FormData
  ) => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NamingItem[] | null>(null)
  const [loading, setLoading] = useState(false)

  const fd = () => {
    const f = new FormData()
    f.set('scope', n.scope)
    f.set('norm_key', n.norm_key)
    return f
  }

  // Loaded once per row and kept, so collapsing and reopening a large issue
  // does not re-fetch 500 rows.
  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && items === null) {
      setLoading(true)
      setItems(await namingItems(n.scope, n.norm_key))
      setLoading(false)
    }
  }

  const exportItems = () => {
    if (!items?.length) return
    download(
      `frem-naming-${n.scope.toLowerCase().replace(/\W+/g, '-')}-${n.norm_key
        .toLowerCase()
        .replace(/\W+/g, '-')}-${stamp()}.csv`,
      toCsv(
        ['Typed as', 'SKU', 'Product', 'Variant', 'On hand'],
        items.map((i) => [
          i.typed_as,
          i.sku,
          i.product_title,
          i.variant_title,
          i.available,
        ])
      )
    )
  }

  const held = daysSince(n.claim?.claimed_at ?? null)
  // Claimed and still here after three days is the accountability signal.
  // Anything shorter is just work in progress.
  const stale = n.claim !== null && held !== null && held >= 3

  return (
    <>
      <tr className="border-b border-border transition-colors hover:bg-surface-muted">
        <td className="py-2 align-top">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={open ? 'Hide affected items' : 'Show affected items'}
            className="px-1 text-muted transition-colors hover:text-foreground"
          >
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td className="whitespace-nowrap py-2 pr-4 align-top text-muted">
          {n.scope}
        </td>
        <td className="py-2 pr-4 align-top">
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
        <td className="numeric py-2 pr-4 text-right align-top text-danger">
          {n.spellings}
        </td>
        <td className="numeric py-2 pr-4 text-right align-top">
          {num(n.affected_variants)}
        </td>
        <td className="py-2 pr-4 align-top text-xs">
          {n.claim ? (
            <span className={stale ? 'text-danger' : 'text-muted'}>
              {n.claim.actor.split('@')[0]}
              <br />
              {ago(n.claim.claimed_at)}
              {stale && ' · not fixed'}
            </span>
          ) : (
            <span className="text-muted">unclaimed</span>
          )}
        </td>
        <td className="py-2 text-right align-top">
          {unlocked && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(n.claim ? releaseNaming : claimNaming, fd())}
              className="border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground disabled:opacity-40"
            >
              {n.claim ? 'Release' : 'Claim'}
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr className="border-b border-border">
          <td />
          <td colSpan={6} className="py-3 pr-4">
            {loading ? (
              <p className="text-xs text-muted">Loading affected items…</p>
            ) : !items?.length ? (
              <p className="text-xs text-muted">
                No items returned. Apply the 0019 migration if this is new.
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {num(items.length)} of {num(n.affected_variants)} shown
                    {items.length < n.affected_variants && ' — capped at 500'}
                  </span>
                  <button
                    type="button"
                    onClick={exportItems}
                    className="border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
                  >
                    CSV of these items
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto border border-border">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-border text-left uppercase tracking-wider text-muted">
                        <th className="px-2 py-1.5 font-normal">Typed as</th>
                        <th className="px-2 py-1.5 font-normal">SKU</th>
                        <th className="px-2 py-1.5 font-normal">Product</th>
                        <th className="px-2 py-1.5 text-right font-normal">
                          On hand
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i, idx) => (
                        <tr
                          key={`${i.sku}-${idx}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-2 py-1.5">
                            <code className="border border-border px-1">
                              {i.typed_as}
                            </code>
                          </td>
                          <td className="numeric px-2 py-1.5">
                            {i.sku ?? '—'}
                          </td>
                          <td className="max-w-md truncate px-2 py-1.5">
                            {i.product_title ?? '—'}
                          </td>
                          <td className="numeric px-2 py-1.5 text-right">
                            {num(i.available)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
