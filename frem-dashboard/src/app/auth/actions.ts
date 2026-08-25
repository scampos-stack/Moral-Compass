'use server'

import { redirect } from 'next/navigation'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Ends the session and returns to the login page. */
export async function signOut() {
  const jar = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return jar.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            jar.set(name, value, options)
          }
        },
      },
    }
  )

  await supabase.auth.signOut()
  redirect('/login')
}
