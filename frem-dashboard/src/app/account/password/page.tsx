import { Suspense } from 'react'
import { PasswordForm } from './password-form'

export const dynamic = 'force-dynamic'

/**
 * Set a new password. Reached from a recovery email, or directly by a
 * signed-in user who wants to change theirs.
 *
 * Deliberately outside the (dashboard) group: someone arriving from a
 * recovery link has a session but has not really "logged in" yet, and
 * showing them the full dashboard chrome around a password field invites
 * them to wander off before finishing.
 */
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const { type } = await searchParams
  const inviting = type === 'invite' || type === 'signup'
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <p className="wordmark text-xs text-muted">Frém</p>
          <h1 className="text-2xl">
            {inviting ? 'Create your password' : 'Set a new password'}
          </h1>
          {inviting && (
            <p className="text-sm text-muted">
              Welcome. Pick a password and you are in.
            </p>
          )}
        </div>
        <Suspense fallback={null}>
          <PasswordForm inviting={inviting} />
        </Suspense>
      </div>
    </main>
  )
}
