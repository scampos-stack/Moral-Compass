'use client'

import { useActionState } from 'react'
import { submitPasscode, lockEditing, type EntryState } from './actions'

export function PasscodeForm() {
  const [state, action, pending] = useActionState<EntryState, FormData>(
    submitPasscode,
    null
  )

  return (
    <form
      action={action}
      className="flex flex-wrap items-center gap-3 border border-border bg-surface-muted px-4 py-3"
    >
      <span className="text-xs uppercase tracking-wider text-muted">
        View only
      </span>
      <input
        type="password"
        name="passcode"
        inputMode="numeric"
        required
        placeholder="Edit code"
        className="w-28 border border-border bg-surface px-2 py-1 text-sm focus:border-foreground focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-foreground px-4 py-1.5 text-xs uppercase tracking-wider text-background disabled:opacity-40"
      >
        {pending ? '…' : 'Unlock'}
      </button>
      {state && !state.ok && (
        <span role="status" className="text-sm text-danger">
          {state.message}
        </span>
      )}
    </form>
  )
}

export function LockButton() {
  return (
    <form action={lockEditing}>
      <button
        type="submit"
        className="text-xs uppercase tracking-wider text-muted underline underline-offset-4 hover:text-foreground"
      >
        Lock editing
      </button>
    </form>
  )
}
