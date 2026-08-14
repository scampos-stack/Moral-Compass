export const RANGES = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
  custom: 'Custom',
} as const

export type RangeKey = keyof typeof RANGES

export function parseRange(value?: string): RangeKey {
  return value && value in RANGES ? (value as RangeKey) : 'all'
}

/**
 * Resolves a range to an inclusive [from, to) pair of ISO instants.
 * `null` on either side means unbounded.
 *
 * Custom `to` is pushed to the end of the chosen day: a user picking
 * 14 Aug means "through the 14th", not "up to midnight as it began".
 */
export function resolveRange(
  key: RangeKey,
  from?: string,
  to?: string
): { from: string | null; to: string | null } {
  if (key === 'all') return { from: null, to: null }

  if (key === 'custom') {
    const end = to ? new Date(`${to}T00:00:00.000Z`) : null
    if (end) end.setUTCDate(end.getUTCDate() + 1)
    return {
      from: from ? `${from}T00:00:00.000Z` : null,
      to: end ? end.toISOString() : null,
    }
  }

  const now = new Date()
  if (key === 'today') {
    return { from: now.toISOString().slice(0, 10) + 'T00:00:00.000Z', to: null }
  }

  const days = key === '7d' ? 7 : key === '30d' ? 30 : 90
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - days)
  return { from: start.toISOString(), to: null }
}

/**
 * A plain GET form: no client JavaScript, and the chosen range lives in the
 * URL so it survives a refresh and can be pasted to someone else.
 */
export function RangeFilter({
  active,
  from,
  to,
}: {
  active: RangeKey
  from?: string
  to?: string
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          Timeline
        </span>
        <select
          name="range"
          defaultValue={active}
          className="border border-border bg-surface px-3 py-1.5 text-sm focus:border-foreground focus:outline-none"
        >
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <option key={k} value={k}>
              {RANGES[k]}
            </option>
          ))}
        </select>
      </label>

      {/* Always rendered, so switching to Custom needs no round trip. */}
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          From
        </span>
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="border border-border bg-surface px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          To
        </span>
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="border border-border bg-surface px-2 py-1.5 text-sm focus:border-foreground focus:outline-none"
        />
      </label>

      <button
        type="submit"
        className="border border-foreground bg-foreground px-4 py-1.5 text-xs uppercase tracking-wider text-background"
      >
        Apply
      </button>
    </form>
  )
}
