import { Suspense } from 'react'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <p className="wordmark text-xs text-muted">Frém</p>
          <h1 className="text-2xl">Moral Compass</h1>
          <p className="text-sm text-muted">
            Wholesale outreach and revenue. Access is by invitation.
          </p>
        </div>

        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>

        <p className="text-xs text-muted">
          No account? There is no sign-up — accounts are created for you.
          Ask whoever runs this dashboard to add you.
        </p>
      </div>
    </main>
  )
}
