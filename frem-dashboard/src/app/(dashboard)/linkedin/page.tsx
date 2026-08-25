import Link from 'next/link'
import { createReadClient } from '@/lib/supabase/read'
import { isUnlocked } from '@/lib/edit-gate'
import { EntryForm } from './entry-form'
import { PasscodeForm, LockButton } from './passcode-form'

export const dynamic = 'force-dynamic'

type Row = {
  activity_date: string
  connections_sent: number
  connections_accepted: number
  inmails: number
  network_total: number | null
  replies_positive: number
  replies_neutral: number
  replies_negative: number
  replies_total: number
  notes: string | null
}

/** Percentage, or an em dash — never #DIV/0!, which is what the sheet shows. */
function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return '—'
  return `${((100 * numerator) / denominator).toFixed(1)}%`
}

export default async function LinkedInPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>
}) {
  const { edit } = await searchParams
  const supabase = createReadClient()

  const { data, error } = await supabase
    .from('linkedin_daily')
    .select(
      'activity_date, connections_sent, connections_accepted, inmails, network_total, replies_positive, replies_neutral, replies_negative, replies_total, notes'
    )
    .order('activity_date', { ascending: false })
    .limit(30)

  const rows = (data ?? []) as Row[]
  const today = new Date().toISOString().slice(0, 10)
  const unlocked = await isUnlocked()

  const editing = edit ? (rows.find((r) => r.activity_date === edit) ?? null) : null

  // The most recent total BEFORE the day being edited — otherwise editing an
  // old day would compare against a total recorded after it.
  const reference = rows
    .filter(
      (r) =>
        r.network_total !== null &&
        r.activity_date < (editing?.activity_date ?? today)
    )
    .sort((a, b) => b.activity_date.localeCompare(a.activity_date))[0]

  return (
    <main className="mx-auto max-w-4xl space-y-12 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl">
            {editing ? `Editing ${editing.activity_date}` : 'LinkedIn — daily entry'}
          </h1>
          <p className="text-sm text-muted">
            LinkedIn has no API for outreach activity, so this is keyed by hand.
            Enter your network total and acceptances are worked out from it.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {editing && (
            <Link
              href="/linkedin"
              className="text-xs uppercase tracking-wider text-muted underline underline-offset-4"
            >
              Cancel edit
            </Link>
          )}
          {unlocked && <LockButton />}
        </div>
      </header>

      {unlocked ? (
        <EntryForm
          key={editing?.activity_date ?? 'new'}
          today={editing?.activity_date ?? today}
          lastNetworkTotal={reference?.network_total ?? null}
          lastNetworkDate={reference?.activity_date ?? null}
          initial={
            editing
              ? {
                  connections_sent: editing.connections_sent,
                  inmails: editing.inmails,
                  network_total: editing.network_total,
                  replies_positive: editing.replies_positive,
                  replies_neutral: editing.replies_neutral,
                  replies_negative: editing.replies_negative,
                  notes: editing.notes,
                }
              : null
          }
        />
      ) : (
        <PasscodeForm />
      )}

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
                  <th className="py-2 pr-4 text-right font-normal">Network</th>
                  <th className="py-2 pr-4 text-right font-normal">Accepted</th>
                  <th className="py-2 pr-4 text-right font-normal">Accept %</th>
                  <th className="py-2 pr-4 text-right font-normal">InMails</th>
                  <th className="py-2 pr-4 text-right font-normal">Replies</th>
                  <th className="py-2 pr-4 font-normal">Notes</th>
                  {unlocked && <th className="py-2 font-normal" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.activity_date}
                    className={
                      'border-b border-border transition-colors hover:bg-surface-muted ' +
                      (r.activity_date === edit ? 'bg-surface-muted' : '')
                    }
                  >
                    <td className="numeric py-2 pr-4">{r.activity_date}</td>
                    <td className="numeric py-2 pr-4 text-right">
                      {r.connections_sent}
                    </td>
                    <td className="numeric py-2 pr-4 text-right text-muted">
                      {r.network_total ?? '—'}
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
                    <td className="py-2 pr-4 text-muted">{r.notes ?? ''}</td>
                    {unlocked && (
                      <td className="py-2 text-right">
                        <Link
                          href={`/linkedin?edit=${r.activity_date}`}
                          className="text-xs uppercase tracking-wider underline underline-offset-4"
                        >
                          Edit
                        </Link>
                      </td>
                    )}
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
