'use client'

import { useActionState } from 'react'
import { saveLinkedInDay, type EntryState } from './actions'

function Field({
  label,
  name,
  defaultValue = 0,
}: {
  label: string
  name: string
  defaultValue?: number
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        defaultValue={defaultValue}
        className="numeric rounded-none border border-border bg-surface px-3 py-2 text-lg focus:border-foreground focus:outline-none"
      />
    </label>
  )
}

export function EntryForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState<EntryState, FormData>(
    saveLinkedInDay,
    null
  )

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
          <Field label="Sent" name="connections_sent" />
          <Field label="Accepted" name="connections_accepted" />
          <Field label="InMails" name="inmails" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs uppercase tracking-wider text-muted">
          Replies
        </legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Positive" name="replies_positive" />
          <Field label="Neutral" name="replies_neutral" />
          <Field label="Negative" name="replies_negative" />
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          Notes <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <textarea
          name="notes"
          rows={2}
          placeholder="New profile picture · blank connection · Sarah off"
          className="rounded-none border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground px-6 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save day'}
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
