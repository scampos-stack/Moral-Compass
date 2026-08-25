import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Gates the dashboard behind a Supabase session.
 *
 * Accounts are created by hand in the Supabase dashboard — there is no
 * sign-up route here, and self-service registration should also be switched
 * off in Supabase (Authentication → Providers → Email → "Allow new users to
 * sign up"). Without that, anyone who reaches the login page could create
 * themselves an account, and a gate anyone can walk through is not a gate.
 *
 * Page data is still read server-side under the service role. This controls
 * who may load a page; it does not open the database to the browser, which
 * stays revoked for anon.
 *
 * Named `proxy` in `proxy.ts` — Next.js 16 deprecated the `middleware`
 * convention in favour of this one.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  // This runs on every request. Without these, createServerClient throws and
  // the whole site returns 500 with nothing explaining why — usually a deploy
  // where the env vars were never set. Say so instead.
  if (!url || !key) {
    return new NextResponse(
      'Supabase environment variables are missing. Set ' +
        'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        'in this deployment, then redeploy.',
      { status: 503, headers: { 'content-type': 'text/plain' } }
    )
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  // Do not run code between createServerClient and getUser — a stray await
  // here makes sessions randomly log out.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // /api/sync/* is not unprotected: it authenticates with CRON_SECRET so a
  // scheduler with no browser session can call it. Redirecting it to /login
  // would turn every scheduled run into a silent 307.
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api/sync') ||
    pathname === '/api/health'

  if (!user && !isPublic) {
    const to = request.nextUrl.clone()
    to.pathname = '/login'
    // Return them where they were headed once signed in.
    to.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(to)
  }

  // A signed-in user hitting /login has no reason to see it.
  if (user && pathname.startsWith('/login')) {
    const to = request.nextUrl.clone()
    to.pathname = '/'
    to.search = ''
    return NextResponse.redirect(to)
  }

  return response
}

export const config = {
  matcher: [
    // Everything except static assets and image files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
