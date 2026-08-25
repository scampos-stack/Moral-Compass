/**
 * Monochrome charts.
 *
 * The Frém identity is black and white, so nothing here encodes meaning in
 * hue. A single series is one solid fill; a two-part series uses solid versus
 * a light tint of the same ink — a two-step sequential ramp, not two
 * categories. Every value is directly labelled or reachable on hover, so the
 * chart never depends on colour to be read. That also makes it safe in
 * greyscale print and for any colour-vision deficiency.
 */

function niceMax(v: number) {
  if (v <= 0) return 1
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / mag) * mag
}

export type Slice = { label: string; value: number; sub?: number }

/**
 * Vertical bars over time. Bars are thin with a 4px rounded top anchored to
 * the baseline, and a 2px gap between neighbours.
 */
export function TimeBars({
  data,
  format,
  height = 160,
}: {
  data: Slice[]
  format: (n: number) => string
  height?: number
}) {
  if (data.length === 0) {
    return (
      <p className="border border-dashed border-border px-4 py-6 text-sm text-muted">
        No data in this range.
      </p>
    )
  }

  const max = niceMax(Math.max(...data.map((d) => d.value), 0))

  return (
    <figure className="space-y-2">
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={`Bar chart, ${data.length} periods, peak ${format(max)}`}
      >
        {data.map((d) => {
          const h = max > 0 ? (100 * d.value) / max : 0
          // `sub` is the highlighted portion (e.g. ATW inside total).
          const subH = d.sub && d.value > 0 ? (100 * d.sub) / max : 0
          return (
            <div
              key={d.label}
              className="group relative flex flex-1 flex-col justify-end"
              style={{ height: '100%' }}
            >
              <div
                className="relative w-full rounded-t-[4px] bg-border transition-colors group-hover:bg-muted"
                style={{ height: `${Math.max(h, d.value > 0 ? 1 : 0)}%` }}
              >
                {subH > 0 && (
                  <div
                    className="absolute bottom-0 w-full rounded-t-[4px] bg-foreground"
                    style={{ height: `${(100 * subH) / h}%` }}
                  />
                )}
              </div>
              {/* Tooltip on hover; the figure below also lists every value. */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap border border-border bg-surface px-2 py-1 text-xs shadow-sm group-hover:block">
                <span className="numeric">{format(d.value)}</span>
                {d.sub !== undefined && (
                  <span className="numeric ml-2 text-muted">
                    ATW {format(d.sub)}
                  </span>
                )}
                <span className="ml-2 text-muted">{d.label}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </figure>
  )
}

/** Legend for the two-tone bars. Present whenever `sub` is in play. */
export function TwoToneLegend({
  whole,
  part,
}: {
  whole: string
  part: string
}) {
  return (
    <div className="flex gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-foreground" />
        {part}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-border" />
        {whole}
      </span>
    </div>
  )
}
