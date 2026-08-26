'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { saveFaireCampaign, type CampaignState } from './actions'

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  hint,
  span = 1,
  value,
}: {
  label: string
  name: string
  type?: string
  placeholder?: string
  hint?: string
  span?: number
  value?: string | number | null
}) {
  return (
    <label
      className="flex flex-col gap-1.5"
      style={{ gridColumn: `span ${span} / span ${span}` }}
    >
      <span className="text-xs uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        // Keyed by the row being edited in the parent, so switching from one
        // campaign to another re-mounts the input and actually shows the new
        // value instead of keeping what was typed.
        defaultValue={value ?? undefined}
        className="border border-border bg-surface px-3 py-2 text-sm focus:border-foreground focus:outline-none"
      />
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </label>
  )
}

/** The stored shape, for prefilling an edit. */
export type EditableCampaign = {
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

/**
 * Log a campaign, or correct one already logged.
 *
 * There is no delete. These numbers are copied off Faire by hand and a
 * mistyped figure is far more likely than an entry that should not exist —
 * deleting and re-adding loses the original date and quietly changes what
 * the trend was built from. Correcting the row in place keeps one history.
 */
export function CampaignForm({ campaign }: { campaign?: EditableCampaign }) {
  const [state, action, pending] = useActionState<CampaignState, FormData>(
    saveFaireCampaign,
    null
  )
  const editing = Boolean(campaign)

  return (
    <form action={action} className="space-y-6 border border-border p-6">
      <input type="hidden" name="id" value={campaign?.id ?? ''} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm">
            {editing ? `Edit “${campaign!.name}”` : 'Log a Faire campaign'}
          </h2>
          <p className="text-xs text-muted">
            {editing
              ? 'Correcting the entry in place. The date it was sent stays part of the same history.'
              : 'Copy the row straight off Faire → Marketing → Campaigns. Values with $ signs, commas or % are accepted as-is.'}
          </p>
        </div>
        {editing && (
          <Link
            href="/faire-campaigns"
            className="border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
          >
            Cancel
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field
          label="Campaign name"
          name="name"
          placeholder="Back To School email 1"
          span={2}
          value={campaign?.name}
        />
        <Field
          label="Date sent"
          name="sent_on"
          type="date"
          value={campaign?.sent_on?.slice(0, 10)}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted">
            Status
          </span>
          <select
            name="status"
            defaultValue={campaign?.status ?? 'Complete'}
            className="border border-border bg-surface px-3 py-2 text-sm focus:border-foreground focus:outline-none"
          >
            <option>Complete</option>
            <option>Scheduled</option>
            <option>Draft</option>
          </select>
        </label>

        <Field
          label="Recipients"
          name="recipients"
          placeholder="All contacts"
          hint="Faire's audience description — part of what makes an entry unique"
          span={2}
          value={campaign?.recipients}
        />
        <Field
          label="Attempted"
          name="attempted"
          placeholder="3,413"
          hint="the second number in 2,976 / 3,413"
          value={campaign?.attempted}
        />
        <Field
          label="Delivered"
          name="delivered"
          placeholder="2,976"
          hint="the first number"
          value={campaign?.delivered}
        />

        <Field
          label="Open rate"
          name="open_rate_pct"
          placeholder="34%"
          value={campaign?.open_rate_pct}
        />
        <Field
          label="Click rate"
          name="click_rate_pct"
          placeholder="0.07%"
          value={campaign?.click_rate_pct}
        />
        <Field
          label="Orders from opens"
          name="orders_from_opens"
          placeholder="1"
          value={campaign?.orders_from_opens}
        />
        <Field
          label="Orders from clicks"
          name="orders_from_clicks"
          placeholder="0"
          value={campaign?.orders_from_clicks}
        />

        <Field
          label="Volume from opens"
          name="volume_from_opens"
          placeholder="$1,548"
          value={campaign?.volume_from_opens}
        />
        <Field
          label="Volume from clicks"
          name="volume_from_clicks"
          placeholder="$0"
          value={campaign?.volume_from_clicks}
        />
        <Field
          label="Creative"
          name="creative_type"
          placeholder="text only / visual / mixed"
          hint="what you were testing"
          value={campaign?.creative_type}
        />
        <Field
          label="Notes"
          name="notes"
          placeholder="optional"
          value={campaign?.notes}
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground px-6 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
        >
          {pending
            ? 'Saving…'
            : editing
              ? 'Update campaign'
              : 'Add campaign'}
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
