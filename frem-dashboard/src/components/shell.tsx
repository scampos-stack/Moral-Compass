import { RangeFilter, RANGES, type RangeKey } from './range-filter'

export function Shell({
  title,
  subtitle,
  range,
  from,
  to,
  meta,
  children,
  showFilter = true,
}: {
  title: string
  subtitle?: string
  range: RangeKey
  from?: string
  to?: string
  meta?: string
  children: React.ReactNode
  showFilter?: boolean
}) {
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-8">
      <header className="space-y-5 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {showFilter && (
          <div className="flex flex-wrap items-end justify-between gap-4">
            <RangeFilter active={range} from={from} to={to} />
            <span className="text-xs text-muted">
              {RANGES[range]}
              {meta ? ` · ${meta}` : ''}
            </span>
          </div>
        )}
      </header>
      {children}
    </main>
  )
}

export function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wider text-muted">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** Shared table chrome, so every section's tables look and behave alike. */
export function Table({
  head,
  children,
}: {
  head: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-border text-xs uppercase tracking-wider text-muted">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-border transition-colors hover:bg-surface-muted">
      {children}
    </tr>
  )
}
