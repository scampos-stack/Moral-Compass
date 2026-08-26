'use client'

import type { Row } from './board'

/**
 * Who ordered what, and when.
 *
 * Deliberately always visible rather than living inside the "On order" tab:
 * the point of a log is that nobody has to go looking for it.
 *
 * Five days is the overdue line — long enough that a same-week delivery is
 * not nagged, short enough that a forgotten purchase order surfaces while
 * the buyer can still chase it. Overdue is measured from the order date and
 * is NOT cleared by stock arriving, because a delivery nobody confirmed is
 * exactly the case worth showing.
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
    .map((r) => ({ r, age: daysSince(r.state?.ordered_at ?? null) ?? 0 }))
    .sort((a, b) => b.age - a.age)
  const overdue = withAge.filter((x) => x.age >= OVERDUE_DAYS)

  return (
    <div className="border border-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs uppercase tracking-wider text-muted">
          Order log
        </span>
        {overdue.length > 0 ? (
          <span className="text-xs text-danger">
            {num(overdue.length)} not received after {OVERDUE_DAYS} days
          </span>
        ) : (
          <span className="numeric text-xs text-muted">
            {num(rows.length)} open
          </span>
        )}
      </div>

      <ul className="max-h-44 divide-y divide-border overflow-y-auto">
        {withAge.map(({ r, age }) => {
          const late = age >= OVERDUE_DAYS
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
              <span className={late ? 'text-danger' : 'text-muted'}>
                {ago(r.state?.ordered_at ?? null)}
                {late && ` · overdue ${age - OVERDUE_DAYS + 1}d`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
