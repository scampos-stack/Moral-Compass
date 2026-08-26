'use client'

import type { Row } from './board'

/**
 * Who ordered what, and when.
 *
 * Deliberately always visible rather than living inside the "On order" tab:
 * the point of a log is that nobody has to go looking for it.
 *
 * Lateness prefers the expected arrival date when the buyer gave one, since
 * that is the real promise to chase against. Five days from the order date
 * is only the fallback for rows with no date — long enough that a same-week
 * delivery is not nagged, short enough that a forgotten order still
 * surfaces.
 *
 * Late is NOT cleared by stock arriving, because a delivery nobody confirmed
 * is exactly the case worth showing. A row where the count has risen is
 * marked "arrived?" instead, and still waits for a human to close it.
 */

const OVERDUE_DAYS = 5

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

export function OrderLog({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null

  const withAge = rows
    .map((r) => {
      const age = daysSince(r.state?.ordered_at ?? null) ?? 0
      const arrived = (r.state?.stock_delta ?? 0) > 0
      // days_late is null when no expected date was set, and only then does
      // the age-based fallback apply.
      const late =
        !arrived &&
        (r.state?.days_late !== null && r.state?.days_late !== undefined
          ? r.state.days_late > 0
          : age >= OVERDUE_DAYS)
      const lateBy =
        r.state?.days_late !== null && r.state?.days_late !== undefined
          ? r.state.days_late
          : age - OVERDUE_DAYS + 1
      return { r, age, arrived, late, lateBy }
    })
    .sort((a, b) => Number(b.late) - Number(a.late) || b.age - a.age)
  const overdue = withAge.filter((x) => x.late)
  const arrived = withAge.filter((x) => x.arrived)

  return (
    <div className="border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-muted">
          Order log
        </span>
        <span className="flex flex-wrap items-baseline gap-3 text-xs">
          {arrived.length > 0 && (
            <span className="text-foreground">
              {num(arrived.length)} arrived, unconfirmed
            </span>
          )}
          {overdue.length > 0 ? (
            <span className="text-danger">{num(overdue.length)} late</span>
          ) : (
            <span className="numeric text-muted">{num(rows.length)} open</span>
          )}
        </span>
      </div>

      <ul className="max-h-44 divide-y divide-border overflow-y-auto">
        {withAge.map(({ r, arrived, late, lateBy }) => {
          return (
            <li
              key={r.variant_id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-xs"
            >
              <span
                className="min-w-0 flex-1 truncate"
                title={r.product_title ?? ''}
              >
                <span className="text-muted">
                  {r.state?.actor.split('@')[0] ?? 'someone'}
                </span>
                {' ordered '}
                <span className="numeric">
                  {r.state?.ordered_qty ? num(r.state.ordered_qty) : '—'}
                </span>
                {' · '}
                {r.product_title ?? r.sku ?? 'unknown'}
              </span>
              <span
                className={
                  late ? 'text-danger' : arrived ? 'text-foreground' : 'text-muted'
                }
              >
                {r.state?.po_number && (
                  <span className="numeric">PO {r.state.po_number} · </span>
                )}
                {r.state?.expected_at
                  ? `due ${r.state.expected_at}`
                  : ago(r.state?.ordered_at ?? null)}
                {arrived && ' · arrived?'}
                {late && ` · late ${lateBy}d`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
