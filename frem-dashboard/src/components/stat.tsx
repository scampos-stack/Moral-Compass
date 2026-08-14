/**
 * A single headline figure. Used where the data's job is "one number", which
 * is most of the top of this dashboard — a chart of one value is never right.
 */
export function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="space-y-1 border-l border-border pl-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="numeric text-3xl leading-none">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

/**
 * Horizontal bar row. One neutral fill and a direct label on every bar — with
 * a single series there is nothing for colour to distinguish, so identity
 * lives in the row label and the value sits at the end of the bar.
 */
export function Bar({
  label,
  value,
  max,
  display,
  sub,
}: {
  label: string
  value: number
  max: number
  display: string
  sub?: string
}) {
  // Floor the width so a nonzero value never renders as an invisible sliver.
  const pct = max > 0 ? Math.max((100 * value) / max, value > 0 ? 1.5 : 0) : 0

  return (
    <div className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 py-1.5">
      <span className="truncate text-sm" title={label}>
        {label}
      </span>
      <span className="flex h-5 items-center">
        <span
          className="h-2.5 rounded-r-[4px] bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="numeric text-right text-sm">
        {display}
        {sub && <span className="ml-2 text-xs text-muted">{sub}</span>}
      </span>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-dashed border-border px-4 py-6 text-sm text-muted">
      {children}
    </p>
  )
}
