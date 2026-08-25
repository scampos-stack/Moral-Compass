import { createReadClient } from '@/lib/supabase/read'
import { isUnlocked } from '@/lib/edit-gate'
import { Empty } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { PasscodeForm, LockButton } from '../linkedin/passcode-form'
import { SyncButtons } from './sync-buttons'
import { readRange, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

const LABEL: Record<string, string> = {
  faire: 'Faire orders',
  shopify: 'Shopify orders',
  woodpecker: 'Woodpecker campaigns',
  gohighlevel: 'GoHighLevel pipelines',
}

/** Hours since a timestamp, or null when it never ran. */
function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function freshness(h: number | null) {
  if (h === null) return { text: 'never', stale: true }
  if (h < 1) return { text: 'just now', stale: false }
  if (h < 24) return { text: `${Math.floor(h)}h ago`, stale: false }
  const d = Math.floor(h / 24)
  return { text: `${d} day${d === 1 ? '' : 's'} ago`, stale: d >= 3 }
}

export default async function SyncPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()
  const unlocked = await isUnlocked()

  const { data } = await supabase
    .from('sync_runs')
    .select('source, started_at, finished_at, status, rows_upserted, error')
    .order('started_at', { ascending: false })
    .limit(200)

  const runs = (data ?? []) as Array<{
    source: string
    started_at: string
    finished_at: string | null
    status: string
    rows_upserted: number
    error: string | null
  }>

  // Latest successful run per source — a failed retry must not make the data
  // look fresher than it is.
  const latest = new Map<string, (typeof runs)[number]>()
  for (const r of runs) {
    if (r.status === 'ok' && !latest.has(r.source)) latest.set(r.source, r)
  }

  const sources = ['faire', 'shopify', 'woodpecker', 'gohighlevel']
  const stalest = Math.max(
    ...sources.map((s) => hoursSince(latest.get(s)?.finished_at) ?? 1e9)
  )

  return (
    <Shell
      title="Data"
      subtitle="When each source was last pulled, and how to refresh it"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      <div className="flex justify-end">{unlocked && <LockButton />}</div>

      {stalest > 72 && (
        <div className="border-l-2 border-foreground pl-4">
          <p className="text-sm font-medium">Some data is more than 3 days old</p>
          <p className="mt-1 text-sm text-muted">
            Nothing on this dashboard updates on its own — it reads whatever was
            last pulled. A stale source shows as zero rather than as missing,
            which reads like &ldquo;no sales&rdquo; when it means &ldquo;no
            data&rdquo;. Sync before showing these numbers to anyone.
          </p>
        </div>
      )}

      <Section title="Sources" aside="latest successful pull">
        <Table
          head={
            <>
              <th className="py-2 pr-4 text-left font-normal">Source</th>
              <th className="py-2 pr-4 text-left font-normal">Last pulled</th>
              <th className="py-2 pr-4 text-right font-normal">Rows</th>
              <th className="py-2 text-left font-normal">Status</th>
            </>
          }
        >
          {sources.map((s) => {
            const run = latest.get(s)
            const f = freshness(hoursSince(run?.finished_at))
            return (
              <Row key={s}>
                <td className="py-2 pr-4">{LABEL[s] ?? s}</td>
                <td
                  className={`py-2 pr-4 ${f.stale ? 'text-danger' : 'text-muted'}`}
                >
                  {f.text}
                  {run?.finished_at && (
                    <span className="numeric ml-2 text-muted">
                      {run.finished_at.slice(0, 16).replace('T', ' ')}
                    </span>
                  )}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {run ? num(Number(run.rows_upserted)) : '—'}
                </td>
                <td className="py-2 text-xs uppercase tracking-wider text-muted">
                  {run?.status ?? 'never run'}
                </td>
              </Row>
            )
          })}
        </Table>
      </Section>

      <Section title="Sync now" aside="runs on demand — nothing is scheduled">
        {unlocked ? (
          <SyncButtons />
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Syncing hits live APIs and writes to the database, so it needs the
              edit code.
            </p>
            <PasscodeForm />
          </>
        )}
      </Section>

      <Section title="Recent runs" aside="newest 20">
        {runs.length === 0 ? (
          <Empty>Nothing has been synced yet.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Source</th>
                <th className="py-2 pr-4 text-left font-normal">Started</th>
                <th className="py-2 pr-4 text-right font-normal">Rows</th>
                <th className="py-2 pr-4 text-left font-normal">Status</th>
                <th className="py-2 text-left font-normal">Error</th>
              </>
            }
          >
            {runs.slice(0, 20).map((r) => (
              <Row key={`${r.source}-${r.started_at}`}>
                <td className="py-2 pr-4">{LABEL[r.source] ?? r.source}</td>
                <td className="numeric py-2 pr-4 text-muted">
                  {r.started_at.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(r.rows_upserted))}
                </td>
                <td
                  className={
                    'py-2 pr-4 text-xs uppercase tracking-wider ' +
                    (r.status === 'ok' ? 'text-muted' : 'text-danger')
                  }
                >
                  {r.status}
                </td>
                <td className="max-w-md truncate py-2 text-xs text-danger">
                  {r.error ?? ''}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
