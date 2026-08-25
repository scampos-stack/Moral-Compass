import { createReadClient } from '@/lib/supabase/read'
import { Stat, Empty, Bar } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { readRange, money0, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()

  const [sumRes, funnelRes, recentRes] = await Promise.all([
    supabase.from('v_ghl_pipeline_summary').select('*'),
    supabase.from('v_ghl_stage_funnel').select('*'),
    supabase
      .from('ghl_opportunities')
      .select(
        'id, name, stage_name, status, monetary_value, contact_company, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const pipelines = (sumRes.data ?? []) as Array<{
    pipeline: string
    opportunities: number
    open_count: number
    won_count: number
    lost_count: number
    open_value: number
    won_value: number
    win_rate_pct: number | null
  }>

  const funnel = (funnelRes.data ?? []) as Array<{
    pipeline: string
    stage: string
    opportunities: number
    value: number
  }>

  const recent = (recentRes.data ?? []) as Array<{
    id: string
    name: string | null
    stage_name: string | null
    status: string | null
    monetary_value: number
    contact_company: string | null
    created_at: string | null
  }>

  const totalOpen = pipelines.reduce((a, p) => a + Number(p.open_value), 0)
  const totalWon = pipelines.reduce((a, p) => a + Number(p.won_value), 0)
  const totalOpps = pipelines.reduce((a, p) => a + Number(p.opportunities), 0)
  const totalWonCount = pipelines.reduce((a, p) => a + Number(p.won_count), 0)

  // Funnel grouped by pipeline, so each pipeline scales to its own biggest
  // stage — sharing one scale would flatten the smaller pipelines to nothing.
  const byPipeline = new Map<string, typeof funnel>()
  for (const f of funnel) {
    const arr = byPipeline.get(f.pipeline) ?? []
    arr.push(f)
    byPipeline.set(f.pipeline, arr)
  }

  return (
    <Shell
      title="Pipelines"
      subtitle="GoHighLevel opportunities and deal stages"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Opportunities"
          value={num(totalOpps)}
          note={`${pipelines.length} pipelines`}
        />
        <Stat label="Open value" value={money0(totalOpen)} note="not revenue" />
        <Stat
          label="Won value"
          value={money0(totalWon)}
          note={`${num(totalWonCount)} deals`}
        />
        <Stat
          label="Pipelines"
          value={num(pipelines.length)}
          note="in GoHighLevel"
        />
      </section>

      <Section
        title="By pipeline"
        aside="open value is pipeline, won value is money"
      >
        {pipelines.length === 0 ? (
          <Empty>No pipeline data. Run the GoHighLevel sync.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Pipeline</th>
                <th className="py-2 pr-4 text-right font-normal">Opps</th>
                <th className="py-2 pr-4 text-right font-normal">Open</th>
                <th className="py-2 pr-4 text-right font-normal">Won</th>
                <th className="py-2 pr-4 text-right font-normal">Lost</th>
                <th className="py-2 pr-4 text-right font-normal">Win %</th>
                <th className="py-2 pr-4 text-right font-normal">Open value</th>
                <th className="py-2 text-right font-normal">Won value</th>
              </>
            }
          >
            {pipelines.map((p) => (
              <Row key={p.pipeline}>
                <td className="py-2 pr-4">{p.pipeline}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.opportunities))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.open_count))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(p.won_count))}
                </td>
                <td className="numeric py-2 pr-4 text-right text-muted">
                  {num(Number(p.lost_count))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {p.win_rate_pct === null ? '—' : `${p.win_rate_pct}%`}
                </td>
                <td className="numeric py-2 pr-4 text-right text-muted">
                  {money0(Number(p.open_value))}
                </td>
                <td className="numeric py-2 text-right">
                  {money0(Number(p.won_value))}
                </td>
              </Row>
            ))}
          </Table>
        )}

        {pipelines.some(
          (p) => /chain/i.test(p.pipeline) && Number(p.open_value) === 0
        ) && (
          <p className="text-xs text-muted">
            Chain Store carries no deal values. LinkedIn revenue is recorded
            here, so it reads as zero until amounts are entered on those
            opportunities.
          </p>
        )}
      </Section>

      <Section title="Where open deals sit" aside="each pipeline scaled to itself">
        {byPipeline.size === 0 ? (
          <Empty>No open opportunities.</Empty>
        ) : (
          <div className="space-y-6">
            {[...byPipeline.entries()].map(([pipeline, stages]) => {
              const max = Math.max(
                ...stages.map((s) => Number(s.opportunities)),
                0
              )
              return (
                <div key={pipeline} className="space-y-1">
                  <p className="text-sm">{pipeline}</p>
                  {stages
                    .sort((a, b) => b.opportunities - a.opportunities)
                    .map((s) => (
                      <Bar
                        key={s.stage}
                        label={s.stage ?? '—'}
                        value={Number(s.opportunities)}
                        max={max}
                        display={num(Number(s.opportunities))}
                        sub={
                          Number(s.value) > 0
                            ? money0(Number(s.value))
                            : undefined
                        }
                      />
                    ))}
                </div>
              )
            })}
          </div>
        )}
      </Section>

      <Section title="Recent opportunities" aside="newest 20">
        {recent.length === 0 ? (
          <Empty>No opportunities synced.</Empty>
        ) : (
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Name</th>
                <th className="py-2 pr-4 text-left font-normal">Company</th>
                <th className="py-2 pr-4 text-left font-normal">Stage</th>
                <th className="py-2 pr-4 text-left font-normal">Status</th>
                <th className="py-2 pr-4 text-left font-normal">Created</th>
                <th className="py-2 text-right font-normal">Value</th>
              </>
            }
          >
            {recent.map((o) => (
              <Row key={o.id}>
                <td className="py-2 pr-4">{o.name ?? '—'}</td>
                <td className="py-2 pr-4 text-muted">
                  {o.contact_company ?? '—'}
                </td>
                <td className="py-2 pr-4">{o.stage_name ?? '—'}</td>
                <td className="py-2 pr-4 text-xs uppercase tracking-wider text-muted">
                  {o.status ?? '—'}
                </td>
                <td className="numeric py-2 pr-4 text-muted">
                  {o.created_at?.slice(0, 10) ?? '—'}
                </td>
                <td className="numeric py-2 text-right">
                  {Number(o.monetary_value) > 0
                    ? money0(Number(o.monetary_value))
                    : '—'}
                </td>
              </Row>
            ))}
          </Table>
        )}
      </Section>
    </Shell>
  )
}
