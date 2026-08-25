'use client'

import { useState } from 'react'
import { useActionState } from 'react'
import { saveLinkedInDay, type EntryState } from './actions'

function Field({
  label,
  name,
  defaultValue = 0,
  hint,
}: {
  label: string
  name: string
  defaultValue?: number | null
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        defaultValue={defaultValue ?? 0}
        className="numeric rounded-none border border-border bg-surface px-3 py-2 text-lg focus:border-foreground focus:outline-none"
      />
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </label>
  )
}

export type EntryInitial = {
  connections_sent: number
  inmails: number
  network_total: number | null
  replies_positive: number
  replies_neutral: number
  replies_negative: number
  notes: string | null
}

export function EntryForm({
  today,
  lastNetworkTotal,
  lastNetworkDate,
  initial,
}: {
  today: string
  lastNetworkTotal: number | null
  lastNetworkDate: string | null
  initial?: EntryInitial | null
}) {
  const [state, formAction, pending] = useActionState<EntryState, FormData>(
    saveLinkedInDay,
    null
  )
  const [networkTotal, setNetworkTotal] = useState(
    initial?.network_total != null ? String(initial.network_total) : ''
  )

  // Same arithmetic the spreadsheet did by hand (=1046-1038), shown live so
  // a mistyped total is obvious before saving rather than after.
  const typed = Number(networkTotal)
  const derived =
    networkTotal !== '' && Number.isFinite(typed) && lastNetworkTotal !== null
      ? typed - lastNetworkTotal
      : null

  return (
    <form action={formAction} className="space-y-6">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">Date</span>
        <input
          type="date"
          name="activity_date"
          defaultValue={today}
          required
          className="rounded-none border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wider text-muted">
          Connections
        </legend>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Sent"
            name="connections_sent"
            defaultValue={initial?.connections_sent ?? 0}
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">
              Network total
            </span>
            <input
              type="number"
              name="network_total"
              min={0}
              value={networkTotal}
              onChange={(e) => setNetworkTotal(e.target.value)}
              placeholder={
                lastNetworkTotal !== null ? String(lastNetworkTotal) : '852'
              }
              className="numeric rounded-none border border-border bg-surface px-3 py-2 text-lg focus:border-foreground focus:outline-none"
            />
            <span className="text-[10px] text-muted">
              {lastNetworkTotal !== null
                ? `last: ${lastNetworkTotal.toLocaleString()} on ${lastNetworkDate}`
                : 'first entry — type your current total'}
            </span>
          </label>

          <Field label="InMails" name="inmails" defaultValue={initial?.inmails ?? 0} />
        </div>

        {/* The derived figure, or an explanation of why there isn't one. */}
        <div className="border border-border bg-surface-muted px-4 py-3 text-sm">
          {derived !== null ? (
            derived >= 0 ? (
              <span>
                Accepted today:{' '}
                <span className="numeric text-lg">{derived}</span>
                <span className="ml-2 text-muted">
                  {typed.toLocaleString()} − {lastNetworkTotal!.toLocaleString()}
                </span>
              </span>
            ) : (
              <span className="text-danger">
                That total is {Math.abs(derived)} lower than the last one
                ({lastNetworkTotal!.toLocaleString()}). Saved as 0 accepted —
                check the number if that was not a disconnect.
              </span>
            )
          ) : lastNetworkTotal === null ? (
            <span className="text-muted">
              No previous total recorded, so today only sets the baseline.
              Tomorrow&apos;s entry will show acceptances.
            </span>
          ) : (
            <span className="text-muted">
              Enter your network total and acceptances are worked out from it.
            </span>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wider text-muted">
          Replies
        </legend>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Positive"
            name="replies_positive"
            defaultValue={initial?.replies_positive ?? 0}
          />
          <Field
            label="Neutral"
            name="replies_neutral"
            defaultValue={initial?.replies_neutral ?? 0}
          />
          <Field
            label="Negative"
            name="replies_negative"
            defaultValue={initial?.replies_negative ?? 0}
          />
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          Notes <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ''}
          placeholder="Started the High-End Corporate Buyers list · new profile picture"
          className="rounded-none border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground px-6 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
        >
          {pending ? 'Saving…' : initial ? 'Update day' : 'Save day'}
        </button>

        {state && (
          <p
            role="status"
            className={`text-sm ${state.ok ? 'text-muted' : 'text-danger'}`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  )
}
