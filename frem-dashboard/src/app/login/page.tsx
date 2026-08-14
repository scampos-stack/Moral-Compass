'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'password' | 'link'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setFailed(false)

    const supabase = createClient()

    if (mode === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setFailed(true)
        setMessage(error.message)
      } else {
        // Full reload so the proxy sees the new session cookie.
        router.refresh()
        window.location.href = '/'
        return
      }
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      setFailed(Boolean(error))
      setMessage(error ? error.message : 'Check your inbox for the sign-in link.')
    }

    setBusy(false)
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <p className="wordmark text-sm text-muted">Frém</p>
          <h1 className="text-2xl">Moral Compass</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
          />

          {mode === 'password' && (
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full border border-border bg-surface px-3 py-2 focus:border-foreground focus:outline-none"
            />
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-foreground px-3 py-2.5 text-sm uppercase tracking-wider text-background disabled:opacity-40"
          >
            {busy ? 'Working…' : mode === 'password' ? 'Sign in' : 'Send sign-in link'}
          </button>

          {message && (
            <p
              role="status"
              className={`text-sm ${failed ? 'text-danger' : 'text-muted'}`}
            >
              {message}
            </p>
          )}
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'password' ? 'link' : 'password')
            setMessage('')
          }}
          className="text-xs uppercase tracking-wider text-muted underline underline-offset-4"
        >
          {mode === 'password' ? 'Use an email link instead' : 'Use a password instead'}
        </button>
      </div>
    </main>
  )
}
