'use client'

import { useActionState } from 'react'
import { runSync, type SyncState } from './actions'

const SOURCES = [
  { id: 'all', label: 'Sync everything' },
  { id: 'faire', label: 'Faire' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'woodpecker', label: 'Woodpecker' },
  { id: 'ghl', label: 'GoHighLevel' },
] as const

export function SyncButtons() {
  const [state, action, pending] = useActionState<SyncState, FormData>(
    runSync,
    null
  )

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="submit"
            name="source"
            value={s.id}
            disabled={pending}
            className={
              'px-4 py-2 text-xs uppercase tracking-wider transition-colors disabled:opacity-40 ' +
              (s.id === 'all'
                ? 'bg-foreground text-background'
                : 'border border-border text-muted hover:border-foreground hover:text-foreground')
            }
          >
            {pending ? 'Syncing…' : s.label}
          </button>
        ))}
      </div>

      {pending && (
        <p className="text-sm text-muted">
          Fetching from the source APIs. Faire is the slow one — a month of
          orders takes a minute or so. Leave this page open.
        </p>
      )}

      {state && !pending && (
        <p
          role="status"
          className={`text-sm ${state.ok ? 'text-muted' : 'text-danger'}`}
        >
          {state.message}
        </p>
      )}
    </form>
  )
}
