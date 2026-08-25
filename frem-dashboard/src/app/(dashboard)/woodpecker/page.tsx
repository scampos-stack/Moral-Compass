import Link from 'next/link'
import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty } from '@/components/stat'
import { Shell, Section } from '@/components/shell'
import { readRange, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

type Campaign = {
  id: number
  name: string
  status: string | null
  from_email: string | null
  prospects: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  invalid: number
  optout: number
  interested: number
  maybe_later: number
  not_interested: number
  synced_at: string
}

const STATUSES = ['All', 'RUNNING', 'STOPPED', 'COMPLETED', 'DRAFT'] as const

const rate = (n: number, d: number) => (d > 0 ? (100 * n) / d : null)
const showRate = (n: number | null, dp = 1) =>
  n === null ? '—' : `${n.toFixed(dp)}%`

export default async function WoodpeckerPage({
  searchParams,
}: {
  searchParams: SearchParams & Promise<{ status?: string }>
}) {
  const sp = await searchParams
  const { range, from, to } = await readRange(searchParams)
  const status =
    sp.status && STATUSES.includes(sp.status as (typeof STATUSES)[number])
      ? sp.status
      : 'All'

  const supabase = createReadClient()
  const { data } = await supabase
    .from('woodpecker_campaigns')
    .select('*')
    .order('sent', { ascending: false })

  const all = (data ?? []) as Campaign[]
  const campaigns =
    status === 'All' ? all : all.filter((c) => c.status === status)

  const t = campaigns.reduce(
    (a, c) => ({
      prospects: a.prospects + Number(c.prospects),
      sent: a.sent + Number(c.sent),
      delivered: a.delivered + Number(c.delivered),
      opened: a.opened + Number(c.opened),
      clicked: a.clicked + Number(c.clicked),
      replied: a.replied + Number(c.replied),
      bounced: a.bounced + Number(c.bounced),
      pos: a.pos + Number(c.interested),
      neu: a.neu + Number(c.maybe_later),
      neg: a.neg + Number(c.not_interested),
    }),
    {
      prospects: 0,
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      replied: 0,
      bounced: 0,
      pos: 0,
      neu: 0,
      neg: 0,
    }
  )

  const sentiment = t.pos + t.neu + t.neg
  const lastPull = all
    .map((c) => c.synced_at)
    .sort()
    .at(-1)

  const running = all.filter((c) => c.status === 'RUNNING').length

  return (
    <Shell
      title="Woodpecker"
      subtitle="Cold email sequences and their replies"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Sent"
          value={num(t.sent)}
          note={`${num(campaigns.length)} campaigns`}
        />
        <Stat
          label="Open rate"
          value={showRate(rate(t.opened, t.delivered))}
          note={`${num(t.opened)} of ${num(t.delivered)} delivered`}
        />
        <Stat
          label="Reply rate"
          value={showRate(rate(t.replied, t.sent), 2)}
          note={`${num(t.replied)} replies`}
        />
        <Stat
          label="Bounce rate"
          value={showRate(rate(t.bounced, t.sent), 2)}
          note={`${num(t.bounced)} bounced`}
        />
      </section>

      {/* Reply sentiment, straight from Woodpecker's own tags. */}
      <Section
        title="Response sentiment"
        aside="Woodpecker's interested / maybe / not-interested tags"
      >
        {sentiment === 0 ? (
          <Empty>
            No replies have been categorised yet. These come from Woodpecker&apos;s
            own tags, so they appear once someone marks a reply in Woodpecker.
          </Empty>
        ) : (
          <div className="space-y-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-[4px]">
              <div
                className="bg-foreground"
                style={{ width: `${(100 * t.pos) / sentiment}%` }}
              />
              <div
                className="bg-muted"
                style={{ width: `${(100 * t.neu) / sentiment}%` }}
              />
              <div
                className="bg-border"
                style={{ width: `${(100 * t.neg) / sentiment}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-5 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-foreground" />
                <span className="numeric">{num(t.pos)}</span> interested
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-muted" />
                <span className="numeric">{num(t.neu)}</span> maybe later
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-border" />
                <span className="numeric">{num(t.neg)}</span> not interested
              </span>
            </div>
            <p className="text-xs text-muted">
              These are Woodpecker&apos;s own reply tags, not inferred sentiment —
              a reply only counts once a human has categorised it there.
            </p>
          </div>
        )}
      </Section>

      {/* Status filter — plain links, so the choice lives in the URL. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted">
          Status
        </span>
        {STATUSES.map((sVal) => {
          const count =
            sVal === 'All' ? all.length : all.filter((c) => c.status === sVal).length
          if (sVal !== 'All' && count === 0) return null
          const active = sVal === status
          return (
            <Link
              key={sVal}
              href={`/woodpecker?status=${sVal}`}
              aria-current={active ? 'page' : undefined}
              className={
                'border px-3 py-1 text-xs uppercase tracking-wider transition-colors ' +
                (active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted hover:border-foreground hover:text-foreground')
              }
            >
              {sVal === 'All' ? 'All' : sVal.toLowerCase()} ({count})
            </Link>
          )
        })}
        {lastPull && (
          <span className="ml-auto text-xs text-muted">
            last pulled {lastPull.slice(0, 10)}
          </span>
        )}
      </div>

      <Section
        title="Campaigns"
        aside={
          running > 0
            ? `${num(running)} running of ${num(all.length)}`
            : `${num(all.length)} total`
        }
      >
        {campaigns.length === 0 ? (
          <Empty>
            {all.length === 0
              ? 'No Woodpecker data yet. Run the Woodpecker sync.'
              : `No campaigns with status ${status.toLowerCase()}.`}
          </Empty>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => {
              const openRate = rate(c.opened, c.delivered)
              const replyRate = rate(c.replied, c.sent)
              const bounceRate = rate(c.bounced, c.sent)
              // Woodpecker keeps prospects queued beyond what it has sent.
              const queued = Number(c.prospects) - Number(c.sent)

              return (
                <article
                  key={c.id}
                  className="border-l-2 border-foreground bg-surface-muted p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">{c.name}</h3>
                    <span className="text-[10px] uppercase tracking-wider text-muted">
                      {c.status?.toLowerCase() ?? 'unknown'}
                      {c.from_email ? ` · ${c.from_email}` : ''}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-4 md:grid-cols-6">
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {num(Number(c.sent))}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Sent
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {showRate(openRate)}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Open rate
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {num(Number(c.clicked))}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Clicked
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {num(Number(c.delivered))}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Delivered
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {showRate(bounceRate, 2)}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Bounce rate
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-xl leading-none">
                        {num(Number(c.interested))} / {num(Number(c.maybe_later))}{' '}
                        / {num(Number(c.not_interested))}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Yes / maybe / no
                      </dt>
                    </div>
                  </dl>

                  <p className="mt-3 text-xs text-muted">
                    {num(Number(c.replied))} replies ({showRate(replyRate, 2)})
                    {queued > 0 && ` · ${num(queued)} prospects not yet sent`}
                    {Number(c.optout) > 0 && ` · ${num(Number(c.optout))} opted out`}
                    {Number(c.invalid) > 0 && ` · ${num(Number(c.invalid))} invalid`}
                  </p>
                </article>
              )
            })}
          </div>
        )}
      </Section>
    </Shell>
  )
}
