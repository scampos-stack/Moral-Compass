import Link from 'next/link'

export const RANGES = {
  '7d': { label: '7 days', days: 7 },
  '30d': { label: '30 days', days: 30 },
  '90d': { label: '90 days', days: 90 },
  all: { label: 'All time', days: null },
} as const

export type RangeKey = keyof typeof RANGES

export function parseRange(value?: string): RangeKey {
  return value && value in RANGES ? (value as RangeKey) : '30d'
}

/** Start of the window as an ISO date, or null for all-time. */
export function rangeStart(key: RangeKey): string | null {
  const days = RANGES[key].days
  if (days === null) return null
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

/** Filters sit in one row above the content, and each is a real link so the
 *  selected range survives a refresh and can be shared. */
export function RangeFilter({
  active,
  basePath = '/',
}: {
  active: RangeKey
  basePath?: string
}) {
  return (
    <nav className="flex gap-1" aria-label="Time range">
      {(Object.keys(RANGES) as RangeKey[]).map((key) => {
        const selected = key === active
        return (
          <Link
            key={key}
            href={`${basePath}?range=${key}`}
            aria-current={selected ? 'page' : undefined}
            className={
              'border px-3 py-1 text-xs uppercase tracking-wider transition-colors ' +
              (selected
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-muted hover:border-foreground hover:text-foreground')
            }
          >
            {RANGES[key].label}
          </Link>
        )
      })}
    </nav>
  )
}
