import Link from 'next/link'
import { createReadClient } from '@/lib/supabase/read'

/**
 * A one-line data-age banner, shown on every page.
 *
 * Exists because a stale source renders as $0 rather than as missing — which
 * reads like "no sales" when it means "nothing was pulled". That distinction
 * is invisible without this, and it is the kind of thing that gets repeated in
 * a client meeting before anyone checks.
 *
 * Only appears when something is actually old; a fresh dashboard says nothing.
 */
export async function Freshness() {
  const supabase = createReadClient()
  const { data } = await supabase
    .from('sync_runs')
    .select('source, finished_at, status')
    .eq('status', 'ok')
    .order('started_at', { ascending: false })
    .limit(100)

  const runs = (data ?? []) as Array<{
    source: string
    finished_at: string | null
  }>

  const latest = new Map<string, string>()
  for (const r of runs) {
    if (r.finished_at && !latest.has(r.source)) latest.set(r.source, r.finished_at)
  }

  const sources = ['faire', 'shopify', 'woodpecker', 'gohighlevel']
  const ages = sources.map((s) => {
    const at = latest.get(s)
    return {
      source: s,
      days: at ? (Date.now() - new Date(at).getTime()) / 86_400_000 : null,
    }
  })

  const never = ages.filter((a) => a.days === null).map((a) => a.source)
  const old = ages
    .filter((a) => a.days !== null && a.days > 2)
    .map((a) => `${a.source} ${Math.floor(a.days as number)}d`)

  if (never.length === 0 && old.length === 0) return null

  const bits = [
    old.length ? `stale: ${old.join(', ')}` : '',
    never.length ? `never synced: ${never.join(', ')}` : '',
  ].filter(Boolean)

  return (
    <div className="border-b border-border bg-surface-muted px-8 py-2 text-xs">
      <span className="text-muted">Data age — {bits.join(' · ')}. </span>
      <Link href="/sync" className="underline underline-offset-2">
        Sync now
      </Link>
    </div>
  )
}
