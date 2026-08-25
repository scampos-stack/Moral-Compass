import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Lands the link from a password-reset or invite email.
 *
 * Supabase sends either a PKCE `code` (newer projects) or a `token_hash`
 * plus `type` (older email templates). Both are handled, because which one
 * arrives depends on the project's email templates rather than on anything
 * this app controls — and guessing wrong makes every reset link dead.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/account/password'

  const jar = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return jar.getAll()
        },
        setAll(list) {
          for (const { name, value, options } of list) {
            jar.set(name, value, options)
          }
        },
      },
    }
  )

  let failure: string | null = null

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    failure = error?.message ?? null
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type: type as 'recovery' | 'invite' | 'signup' | 'email',
      token_hash: tokenHash,
    })
    failure = error?.message ?? null
  } else {
    failure = 'This link is missing its token.'
  }

  if (failure) {
    // Reset links are single-use and time-limited, so an expired one is the
    // common case rather than an exceptional one. Say that plainly.
    const url = new URL('/login', origin)
    url.searchParams.set('error', failure)
    return NextResponse.redirect(url)
  }

  const dest = new URL(next, origin)
  // Carry the link type through: an invitee is CREATING a password, not
  // resetting one, and being told to 'reset' something you never set is
  // confusing on your first ever visit.
  if (type) dest.searchParams.set('type', type)
  return NextResponse.redirect(dest)
}
