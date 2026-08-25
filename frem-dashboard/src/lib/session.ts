import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

/**
 * The signed-in user, read from cookies.
 *
 * Returns null rather than throwing when Supabase is unconfigured, so a
 * misconfigured deploy shows the proxy's 503 explanation instead of an
 * opaque crash inside the layout.
 */
export async function currentUser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null

  const jar = await cookies()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll()
      },
      // Reading only: a Server Component cannot set cookies, and the proxy
      // already refreshed the session on this request.
      setAll() {},
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
