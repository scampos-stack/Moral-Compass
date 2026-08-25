'use client'

import { useActionState } from 'react'
import { saveFaireCampaign, type CampaignState } from './actions'

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  hint,
  span = 1,
}: {
  label: string
  name: string
  type?: string
  placeholder?: string
  hint?: string
  span?: number
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
        className="border border-border bg-surface px-3 py-2 text-sm focus:border-foreground focus:outline-none"
      />
      {hint && <span className="text-[10px] text-muted">{hint}</span>}
    </label>
  )
}

export function CampaignForm() {
  const [state, action, pending] = useActionState<CampaignState, FormData>(
    saveFaireCampaign,
    null
  )

  return (
    <form action={action} className="space-y-6 border border-border p-6">
      <div>
        <h2 className="text-sm">Log a Faire campaign</h2>
        <p className="text-xs text-muted">
          Copy the row straight off Faire → Marketing → Campaigns. Values with
          $ signs, commas or % are accepted as-is.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field
          label="Campaign name"
          name="name"
          placeholder="Back To School email 1"
          span={2}
        />
        <Field label="Date sent" name="sent_on" type="date" />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted">
            Status
          </span>
          <select
            name="status"
            defaultValue="Complete"
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
        />
        <Field
          label="Attempted"
          name="attempted"
          placeholder="3,413"
          hint="the second number in 2,976 / 3,413"
        />
        <Field
          label="Delivered"
          name="delivered"
          placeholder="2,976"
          hint="the first number"
        />

        <Field label="Open rate" name="open_rate_pct" placeholder="34%" />
        <Field label="Click rate" name="click_rate_pct" placeholder="0.07%" />
        <Field
          label="Orders from opens"
          name="orders_from_opens"
          placeholder="1"
        />
        <Field
          label="Orders from clicks"
          name="orders_from_clicks"
          placeholder="0"
        />

        <Field
          label="Volume from opens"
          name="volume_from_opens"
          placeholder="$1,548"
        />
        <Field
          label="Volume from clicks"
          name="volume_from_clicks"
          placeholder="$0"
        />
        <Field
          label="Creative"
          name="creative_type"
          placeholder="text only / visual / mixed"
          hint="what you were testing"
        />
        <Field label="Notes" name="notes" placeholder="optional" />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-foreground px-6 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Add campaign'}
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
