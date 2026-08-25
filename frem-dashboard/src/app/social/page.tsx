import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { TimeBars } from '@/components/chart'
import { readRange, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

export default async function SocialPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to, window } = await readRange(searchParams)
  const supabase = createReadClient()

  let q = supabase
    .from('ghl_social_posts')
    .select('id, platform, status, summary, posted_at')
    .order('posted_at', { ascending: false })
  if (window.from) q = q.gte('posted_at', window.from)
  if (window.to) q = q.lt('posted_at', window.to)

  const { data } = await q.limit(500)

  const posts = (data ?? []) as Array<{
    id: string
    platform: string | null
    status: string | null
    summary: string | null
    posted_at: string | null
  }>

  const byPlatform = new Map<string, number>()
  for (const p of posts) {
    const k = p.platform ?? 'unknown'
    byPlatform.set(k, (byPlatform.get(k) ?? 0) + 1)
  }

  // Posts per month, so cadence is visible rather than just a total.
  const monthly = new Map<string, number>()
  for (const p of posts) {
    if (!p.posted_at) continue
    const k = p.posted_at.slice(0, 7)
    monthly.set(k, (monthly.get(k) ?? 0) + 1)
  }
  const months = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }))

  // Days since the most recent post — the practical measure of whether a
  // buyer checking the profile today sees an active brand.
  const newest = posts.find((p) => p.posted_at)?.posted_at
  const daysSince = newest
    ? Math.floor((Date.now() - new Date(newest).getTime()) / 86_400_000)
    : null

  return (
    <Shell
      title="Social"
      subtitle="Posts published through GoHighLevel"
      range={range}
      from={from}
      to={to}
      meta={`${num(posts.length)} posts`}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label="Posts" value={num(posts.length)} note="in this range" />
        <Stat
          label="Platforms"
          value={num(byPlatform.size)}
          note="posted to"
        />
        <Stat
          label="Last post"
          value={daysSince === null ? '—' : daysSince === 0 ? 'Today' : `${daysSince}d ago`}
          note={newest?.slice(0, 10) ?? 'nothing published'}
        />
        <Stat
          label="Busiest platform"
          value={
            byPlatform.size > 0
              ? [...byPlatform.entries()].sort((a, b) => b[1] - a[1])[0][0]
              : '—'
          }
          note={
            byPlatform.size > 0
              ? `${num([...byPlatform.values()].sort((a, b) => b - a)[0])} posts`
              : ''
          }
        />
      </section>

      {daysSince !== null && daysSince > 14 && (
        <div className="border-l-2 border-foreground pl-4">
          <p className="text-sm font-medium">
            Nothing posted in {daysSince} days
          </p>
          <p className="mt-1 text-sm text-muted">
            Wholesale buyers check social before committing to a brand. A quiet
            feed reads as an inactive supplier — the proposal calls this the
            Trust Gap, and it is the one gap that costs sales without ever
            showing up in outreach numbers.
          </p>
        </div>
      )}

      <Section title="Posts by month" aside="cadence, not reach">
        <TimeBars data={months} format={(n) => `${n} posts`} />
      </Section>

      <Section title="By platform" aside="in this range">
        {byPlatform.size === 0 ? (
          <Empty>No posts in this range.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[...byPlatform.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([platform, count]) => (
                <Stat
                  key={platform}
                  label={platform}
                  value={num(count)}
                  note="posts"
                />
              ))}
          </div>
        )}
      </Section>

      <Section title="Recent posts" aside="newest 25">
        {posts.length === 0 ? (
          <Empty>
            No posts synced. Run the GoHighLevel sync, or publish something.
          </Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Date</th>
                <th className="py-2 pr-4 text-left font-normal">Platform</th>
                <th className="py-2 pr-4 text-left font-normal">Status</th>
                <th className="py-2 text-left font-normal">Summary</th>
              </>
            }
          >
            {posts.slice(0, 25).map((p) => (
              <Row key={p.id}>
                <td className="numeric py-2 pr-4 text-muted">
                  {p.posted_at?.slice(0, 10) ?? '—'}
                </td>
                <td className="py-2 pr-4">{p.platform ?? '—'}</td>
                <td className="py-2 pr-4 text-xs uppercase tracking-wider text-muted">
                  {p.status ?? '—'}
                </td>
                <td className="max-w-md truncate py-2 text-muted">
                  {p.summary ?? '—'}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
