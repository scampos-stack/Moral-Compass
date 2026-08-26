'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  markOrdered,
  markReceived,
  clearReorder,
  claimNaming,
  releaseNaming,
  type ActionState,
} from './actions'

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
 * Two panels side by side rather than stacked, because they are read by the
 * same person in one sitting and the old single column meant scrolling past
 * 261 reorder rows to reach the cleanup list. Reorder takes two thirds: it
 * is the daily job and needs the numeric columns. Naming takes one third and
 * scrolls inside itself, so a long backlog never pushes the page down.
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
  const [tab, setTab] = useState<'open' | 'ordered' | 'masked'>('open')
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
    for (const r of rows) {
      // "Received but still low" deliberately returns to the open list. The
      // order was closed and the shelf is still empty, which is a fact the
      // buyer needs, not a closed ticket.
      if (r.state?.status === 'ordered') ordered.push(r)
      else open.push(r)
      if (r.masked) masked.push(r)
    }
    return { open, ordered, masked }
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
  ] as const

  return (
    <div className="space-y-4">
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

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ── Reorder, two thirds ─────────────────────────────────────── */}
        <div className="space-y-3 lg:col-span-2">
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
              Showing 150 of {num(visible.length)}. Search to narrow.
            </p>
          )}
        </div>

        {/* ── Naming, one third ───────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between border-b border-border pb-2">
            <h2 className="text-xs uppercase tracking-wider text-muted">
              Naming warnings
            </h2>
            <span className="numeric text-xs text-muted">
              {num(visibleNaming.length)}
            </span>
          </div>

          <p className="text-xs text-muted">
            Claiming does not close a row. The list is rebuilt from Shopify on
            every sync, so anything still typed two ways comes back — showing
            who took it and when.
            {fixedSinceClaim > 0 && (
              <>
                {' '}
                <span className="text-foreground">
                  {num(fixedSinceClaim)} fixed so far.
                </span>
              </>
            )}
          </p>

          {visibleNaming.length === 0 ? (
            <p className="border border-dashed border-border px-4 py-6 text-sm text-muted">
              {q ? 'No naming issue matches.' : 'Catalogue is clean.'}
            </p>
          ) : (
            <ul className="max-h-[36rem] divide-y divide-border overflow-y-auto border-y border-border">
              {visibleNaming.map((n) => (
                <NamingRowItem
                  key={`${n.scope}-${n.norm_key}`}
                  row={n}
                  unlocked={unlocked}
                  pending={pending}
                  run={run}
                />
              ))}
            </ul>
          )}
        </div>
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
  // Suggests a quarter's cover at the observed rate, falling back to a round
  // dozen when nothing has sold. A suggestion, not a decision — it is an
  // editable field precisely because the rate is only 60 days deep.
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

function NamingRowItem({
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
  const fd = () => {
    const f = new FormData()
    f.set('scope', n.scope)
    f.set('norm_key', n.norm_key)
    return f
  }

  const held = daysSince(n.claim?.claimed_at ?? null)
  // Claimed and still here after three days is the accountability signal.
  // Anything shorter is just work in progress.
  const stale = n.claim !== null && held !== null && held >= 3

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {n.scope}
        </span>
        <span className="numeric text-xs text-muted">
          {num(n.affected_variants)} variants
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {n.variants_seen.map((v) => (
          <code key={v} className="border border-border px-1.5 py-0.5 text-xs">
            {v}
          </code>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {n.claim ? (
          <span className={`text-xs ${stale ? 'text-danger' : 'text-muted'}`}>
            {n.claim.actor.split('@')[0]} · claimed {ago(n.claim.claimed_at)}
            {stale && ' · not fixed yet'}
          </span>
        ) : (
          <span className="text-xs text-muted">unclaimed</span>
        )}

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
      </div>
    </li>
  )
}
