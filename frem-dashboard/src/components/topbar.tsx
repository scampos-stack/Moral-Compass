'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { runSync, type SyncState } from '@/app/(dashboard)/sync/actions'
import { ThemeToggle } from './theme-toggle'
import { signOut } from '@/app/auth/actions'

/**
 * Persistent header: sync and theme, reachable from every page.
 *
 * When editing is locked the button becomes a link to /sync rather than a
 * dead control — syncing writes to the database, so it stays behind the
 * passcode, but the path to unlock should be one click and not a mystery.
 */
export function Topbar({
  unlocked,
  email,
}: {
  unlocked: boolean
  email?: string | null
}) {
  const [state, action, pending] = useActionState<SyncState, FormData>(
    runSync,
    null
  )

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-8 py-3">
      <div className="min-w-0 flex-1">
        {pending && (
          <span className="text-xs text-muted">
            Syncing all sources — Faire takes a minute. Leave this page open.
          </span>
        )}
        {state && !pending && (
          <span
            role="status"
            className={`text-xs ${state.ok ? 'text-muted' : 'text-danger'}`}
          >
            {state.message}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {email && (
          <span className="hidden text-xs text-muted sm:inline">{email}</span>
        )}
        <ThemeToggle />
        {unlocked ? (
          <form action={action}>
            <input type="hidden" name="source" value="all" />
            <button
              type="submit"
              disabled={pending}
              className="bg-foreground px-4 py-1.5 text-xs uppercase tracking-wider text-background disabled:opacity-40"
            >
              {pending ? 'Syncing…' : 'Sync now'}
            </button>
          </form>
        ) : (
          <Link
            href="/sync"
            className="border border-border px-4 py-1.5 text-xs uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
          >
            Sync now
          </Link>
        )}
        <form action={signOut}>
          <button
            type="submit"
            className="border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
