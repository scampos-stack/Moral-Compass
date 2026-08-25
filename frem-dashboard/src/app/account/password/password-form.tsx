'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function PasswordForm({ inviting = false }: { inviting?: boolean }) {
  const [ready, setReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // A recovery link only works if it produced a session. Checking up front
  // means an expired link says so immediately, rather than after the user has
  // typed a password twice.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)))
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setBusy(false)
      return
    }
    setDone(true)
    setBusy(false)
  }

  if (ready === false) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-danger">
          This link has expired or was already used.
        </p>
        <p className="text-sm text-muted">
          Reset links work once and time out. Request a new one from the sign-in
          page.
        </p>
        <a href="/login" className="text-sm underline underline-offset-4">
          Back to sign in
        </a>
      </div>
    )
  }

  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          {inviting ? 'Password created. You are signed in.' : 'Password updated.'}
        </p>
        <a href="/" className="text-sm underline underline-offset-4">
          Go to the dashboard
        </a>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          {inviting ? 'Password' : 'New password'}
        </span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          Confirm
        </span>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={busy || ready === null}
        className="w-full bg-foreground px-3 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
      >
        {busy ? 'Saving…' : inviting ? 'Create password' : 'Update password'}
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
