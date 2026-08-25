import { createReadClient } from '@/lib/supabase/read'
import { isUnlocked } from '@/lib/edit-gate'
import { Stat, Empty } from '@/components/stat'
import { Shell, Section, Table, Row } from '@/components/shell'
import { PasscodeForm, LockButton } from '../linkedin/passcode-form'
import { CampaignForm } from './campaign-form'
import { deleteFaireCampaign } from './actions'
import { readRange, money0, num, type SearchParams } from '@/lib/dash'

export const dynamic = 'force-dynamic'

type Campaign = {
  id: string
  name: string
  sent_on: string
  status: string | null
  recipients: string | null
  attempted: number
  delivered: number
  open_rate_pct: number | null
  click_rate_pct: number | null
  orders_from_opens: number
  orders_from_clicks: number
  volume_from_opens: number
  volume_from_clicks: number
  creative_type: string | null
  notes: string | null
}

export default async function FaireCampaignsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { range, from, to } = await readRange(searchParams)
  const supabase = createReadClient()
  const unlocked = await isUnlocked()

  const [{ data }, creativeRes] = await Promise.all([
    supabase
      .from('faire_campaigns_manual')
      .select('*')
      .order('sent_on', { ascending: false })
      .limit(100),
    supabase.from('v_creative_performance').select('*'),
  ])

  const campaigns = (data ?? []) as Campaign[]

  const creative = (creativeRes.data ?? []) as Array<{
    creative_type: string
    campaigns: number
    delivered: number
    orders: number
    volume: number
    open_rate_pct: number | null
    click_rate_pct: number | null
    revenue_per_1k: number | null
  }>

  const totals = campaigns.reduce(
    (a, c) => ({
      delivered: a.delivered + Number(c.delivered),
      orders:
        a.orders + Number(c.orders_from_opens) + Number(c.orders_from_clicks),
      volume:
        a.volume + Number(c.volume_from_opens) + Number(c.volume_from_clicks),
    }),
    { delivered: 0, orders: 0, volume: 0 }
  )

  return (
    <Shell
      title="Faire campaigns"
      subtitle="Email sent inside Faire — Marketing → Campaigns"
      range={range}
      from={from}
      to={to}
      showFilter={false}
    >
      <div className="flex justify-end">{unlocked && <LockButton />}</div>

      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat
          label="Campaigns"
          value={num(campaigns.length)}
          note="logged so far"
        />
        <Stat
          label="Delivered"
          value={num(totals.delivered)}
          note="emails landed"
        />
        <Stat
          label="Orders"
          value={num(totals.orders)}
          note="from opens + clicks"
        />
        <Stat
          label="Order volume"
          value={money0(totals.volume)}
          note="Faire's attribution"
        />
      </section>

      {creative.length > 0 && (
        <Section
          title="Creative comparison"
          aside="rates weighted by delivered, not averaged per campaign"
        >
          <Table
            head={
              <>
                <th className="py-2 pr-4 text-left font-normal">Creative</th>
                <th className="py-2 pr-4 text-right font-normal">Sends</th>
                <th className="py-2 pr-4 text-right font-normal">Delivered</th>
                <th className="py-2 pr-4 text-right font-normal">Open %</th>
                <th className="py-2 pr-4 text-right font-normal">Click %</th>
                <th className="py-2 pr-4 text-right font-normal">Orders</th>
                <th className="py-2 pr-4 text-right font-normal">Volume</th>
                <th className="py-2 text-right font-normal">Per 1k sent</th>
              </>
            }
          >
            {creative.map((c) => (
              <Row key={c.creative_type}>
                <td className="py-2 pr-4">{c.creative_type}</td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.campaigns))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.delivered))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.open_rate_pct === null ? '—' : `${c.open_rate_pct}%`}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {c.click_rate_pct === null ? '—' : `${c.click_rate_pct}%`}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {num(Number(c.orders))}
                </td>
                <td className="numeric py-2 pr-4 text-right">
                  {money0(Number(c.volume))}
                </td>
                <td className="numeric py-2 text-right">
                  {c.revenue_per_1k === null
                    ? '—'
                    : money0(Number(c.revenue_per_1k))}
                </td>
              </Row>
            ))}
          </Table>
          <p className="text-xs text-muted">
            Rates are weighted by delivery — averaging per-campaign percentages
            would let an 81-recipient test count as much as an 85,000-recipient
            blast. Revenue per 1,000 delivered is the figure that decides
            whether a treatment is worth repeating.
          </p>
        </Section>
      )}

      {unlocked ? <CampaignForm /> : <PasscodeForm />}

      <Section title="Logged campaigns" aside="newest first">
        {campaigns.length === 0 ? (
          <Empty>
            Nothing logged yet. Faire has no API for Marketing → Campaigns, so
            these are copied from the Faire screen by hand.
          </Empty>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {campaigns.map((c) => {
              const orders =
                Number(c.orders_from_opens) + Number(c.orders_from_clicks)
              const volume =
                Number(c.volume_from_opens) + Number(c.volume_from_clicks)
              const deliveryPct =
                c.attempted > 0 ? (100 * c.delivered) / c.attempted : null

              return (
                <article
                  key={c.id}
                  className="border-l-2 border-foreground bg-surface-muted p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">{c.name}</h3>
                      <p className="text-xs text-muted">
                        {c.creative_type ? c.creative_type + " · " : ""}{c.sent_on}
                        {c.recipients ? ` · ${c.recipients}` : ''}
                      </p>
                    </div>
                    {unlocked && (
                      <form action={deleteFaireCampaign}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="text-xs uppercase tracking-wider text-danger"
                        >
                          Delete
                        </button>
                      </form>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <dd className="numeric text-lg leading-none">
                        {num(Number(c.delivered))}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Delivered
                        {deliveryPct !== null && ` ${deliveryPct.toFixed(0)}%`}
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-lg leading-none">
                        {c.open_rate_pct === null ? '—' : `${c.open_rate_pct}%`}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Open rate
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-lg leading-none">
                        {c.click_rate_pct === null
                          ? '—'
                          : `${c.click_rate_pct}%`}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Click rate
                      </dt>
                    </div>
                    <div>
                      <dd className="numeric text-lg leading-none">
                        {num(orders)}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Orders
                      </dt>
                    </div>
                    <div className="col-span-2">
                      <dd className="numeric text-lg leading-none">
                        {money0(volume)}
                      </dd>
                      <dt className="text-[10px] uppercase tracking-wider text-muted">
                        Order volume
                      </dt>
                    </div>
                  </dl>

                  {c.notes && (
                    <p className="mt-3 text-xs text-muted">{c.notes}</p>
                  )}
                </article>
              )
            })}
          </div>
        )}

        <p className="text-xs text-muted">
          Faire credits an order to opens and to clicks separately, and the same
          order can appear under both. Orders are summed here; treat the two
          volume figures as overlapping rather than additive when a campaign
          shows both.
        </p>
      </Section>
    </Shell>
  )
}
