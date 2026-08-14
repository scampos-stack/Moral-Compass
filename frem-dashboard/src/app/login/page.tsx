'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus('sending')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setStatus('error')
      setMessage(error.message)
    } else {
      setStatus('sent')
      setMessage('Check your inbox for the sign-in link.')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Moral Compass</h1>
          <p className="text-sm text-neutral-500">Frém dashboard</p>
        </div>

        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        />

        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
        </button>

        {message && (
          <p
            className={
              status === 'error'
                ? 'text-sm text-red-600'
                : 'text-sm text-neutral-500'
            }
          >
            {message}
          </p>
        )}
      </form>
    </main>
  )
}
