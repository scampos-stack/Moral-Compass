'use client'

import { useEffect, useRef, useState } from 'react'
import {
  claimNaming,
  releaseNaming,
  namingItems,
  type ActionState,
  type NamingItem,
} from './actions'
import type { NamingRow } from './board'
import { toCsv, download, stamp } from './csv'

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

const PANEL_W = 460
const PANEL_H = 340

/**
 * The affected SKUs, as a dropdown rather than an expanding row.
 *
 * Expanding pushed the table down by 300px and shoved every other warning
 * off screen — for a list that is usually glanced at and closed. This floats
 * over the page instead, so opening one costs no layout at all.
 *
 * Positioned `fixed` from the trigger's own rect, not `absolute`: the panel
 * lives inside a scroll container with overflow hidden, which would clip an
 * absolutely positioned child at the container edge.
 */
function ItemsDropdown({ row }: { row: NamingRow }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [items, setItems] = useState<NamingItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Flip above the trigger when there is not room below, and keep the panel
    // inside the viewport on narrow screens.
    const below = window.innerHeight - r.bottom
    const top = below > PANEL_H + 12 ? r.bottom + 6 : Math.max(8, r.top - PANEL_H - 6)
    const left = Math.max(
      8,
      Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8)
    )
    setPos({ top, left })
  }

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    place()
    setOpen(true)
    // Loaded once and kept, so reopening a large issue does not re-fetch.
    if (items === null) {
      setLoading(true)
      setItems(await namingItems(row.scope, row.norm_key))
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // Reposition rather than trailing behind the trigger, since the panel is
    // fixed and the list behind it scrolls.
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const f = filter.trim().toLowerCase()
  const shown = (items ?? []).filter(
    (i) =>
      !f ||
      (i.sku ?? '').toLowerCase().includes(f) ||
      (i.product_title ?? '').toLowerCase().includes(f) ||
      i.typed_as.toLowerCase().includes(f)
  )

  const exportItems = () => {
    if (!items?.length) return
    download(
      `frem-naming-${row.scope.toLowerCase().replace(/\W+/g, '-')}-${row.norm_key
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

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Show the SKUs to fix"
        className="numeric inline-flex items-center gap-1 border border-transparent px-1.5 py-0.5 transition-colors hover:border-border hover:text-foreground"
      >
        {num(row.affected_variants)}
        <span aria-hidden className="text-[9px] text-muted">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && pos && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`Items affected by ${row.norm_key}`}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: PANEL_W,
            maxHeight: PANEL_H,
          }}
          className="z-50 flex flex-col border border-foreground bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <input
              type="search"
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter these items…"
              className="min-w-0 flex-1 border border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted focus:border-foreground"
            />
            <button
              type="button"
              onClick={exportItems}
              className="shrink-0 border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
            >
              CSV
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-4 text-xs text-muted">Loading…</p>
            ) : shown.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted">
                {items?.length ? 'Nothing matches.' : 'No items returned.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {shown.map((i, idx) => (
                  <li
                    key={`${i.sku}-${idx}`}
                    className="flex items-baseline gap-2 px-3 py-1.5 text-xs"
                  >
                    <code className="shrink-0 border border-border px-1">
                      {i.typed_as}
                    </code>
                    <span className="numeric shrink-0">{i.sku ?? '—'}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-muted"
                      title={i.product_title ?? ''}
                    >
                      {i.product_title ?? '—'}
                    </span>
                    <span className="numeric shrink-0 text-muted">
                      {num(i.available)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted">
            {num(shown.length)} shown of {num(row.affected_variants)}
            {(items?.length ?? 0) >= 500 && ' — loaded 500 max'}
          </p>
        </div>
      )}
    </>
  )
}

export function NamingTableRow({
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
    <tr className="border-b border-border transition-colors hover:bg-surface-muted">
      <td className="whitespace-nowrap py-2 pr-4 align-top text-muted">
        {n.scope}
      </td>
      <td className="py-2 pr-4 align-top">
        <span className="flex flex-wrap gap-1.5">
          {n.variants_seen.map((v) => (
            <code key={v} className="border border-border px-1.5 py-0.5 text-xs">
              {v}
            </code>
          ))}
        </span>
      </td>
      <td className="numeric py-2 pr-4 text-right align-top text-danger">
        {n.spellings}
      </td>
      <td className="py-2 pr-4 text-right align-top">
        <ItemsDropdown row={n} />
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
  )
}
