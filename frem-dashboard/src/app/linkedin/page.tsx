import { createClient } from '@/lib/supabase/server'
import { EntryForm } from './entry-form'

export const dynamic = 'force-dynamic'

type Row = {
  activity_date: string
  connections_sent: number
  connections_accepted: number
  inmails: number
  replies_total: number
  notes: string | null
}

/** Percentage, or an em dash — never #DIV/0!, which is what the sheet shows. */
function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return '—'
  return `${((100 * numerator) / denominator).toFixed(1)}%`
}

export default async function LinkedInPage() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('linkedin_daily')
    .select(
      'activity_date, connections_sent, connections_accepted, inmails, replies_total, notes'
    )
    .order('activity_date', { ascending: false })
    .limit(30)

  const rows = (data ?? []) as Row[]
  const today = new Date().toISOString().slice(0, 10)

  return (
    <main className="mx-auto max-w-4xl space-y-12 p-8">
      <header className="space-y-1">
        <p className="wordmark text-sm">Frém</p>
        <h1 className="text-3xl">LinkedIn — daily entry</h1>
        <p className="text-sm text-muted">
          LinkedIn has no API for outreach activity, so this is keyed by hand.
          Saving a date you have already entered overwrites it.
        </p>
      </header>

      <EntryForm today={today} />

      <section className="space-y-4">
        <h2 className="text-xs uppercase tracking-wider text-muted">
          Last 30 entries
        </h2>

        {error ? (
          <p className="text-sm text-danger">
            Could not load history: {error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing recorded yet. The first save will appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-2 pr-4 font-normal">Date</th>
                  <th className="py-2 pr-4 text-right font-normal">Sent</th>
                  <th className="py-2 pr-4 text-right font-normal">Accepted</th>
                  <th className="py-2 pr-4 text-right font-normal">Accept %</th>
                  <th className="py-2 pr-4 text-right font-normal">InMails</th>
                  <th className="py-2 pr-4 text-right font-normal">Replies</th>
                  <th className="py-2 font-normal">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.activity_date} className="border-b border-border">
                    <td className="numeric py-2 pr-4">{r.activity_date}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {r.connections_sent}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {r.connections_accepted}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">
                      {pct(r.connections_accepted, r.connections_sent)}
                    </td>
                    <td className="numeric py-2 pr-4 text-right">{r.inmails}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {r.replies_total}
                    </td>
                    <td className="py-2 text-muted">{r.notes ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
