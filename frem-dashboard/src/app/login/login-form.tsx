'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resetting, setResetting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      // Supabase returns the same message for a wrong password and an
      // unknown account, which is correct — distinguishing them would let
      // anyone test whether an address has access here.
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'Email or password is not right.'
          : signInError.message
      )
      setBusy(false)
      return
    }

    // Full navigation rather than router.push: the proxy reads the session
    // from cookies, and a client-side transition can outrun the cookie being
    // written, bouncing straight back to /login.
    window.location.assign(next)
  }

  /**
   * Sends a recovery link.
   *
   * The confirmation is identical whether or not the address has an account.
   * Saying 'no such user' would let anyone probe who has access here, and the
   * person who genuinely forgot their password is no worse off.
   */
  async function handleReset() {
    setError('')
    setNotice('')
    if (!email.trim()) {
      setError('Enter your email first, then request a reset.')
      return
    }
    setResetting(true)
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/account/password`,
    })
    setResetting(false)
    setNotice(
      'If that address has an account, a reset link is on its way. Check spam — it can land there.'
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          Email
        </span>
        <input
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted">
          Password
        </span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
        />
      </label>

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-foreground px-3 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={handleReset}
        disabled={resetting}
        className="text-xs uppercase tracking-wider text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
      >
        {resetting ? 'Sending…' : 'Forgot password?'}
      </button>

      {notice && <p className="text-sm text-muted">{notice}</p>}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
