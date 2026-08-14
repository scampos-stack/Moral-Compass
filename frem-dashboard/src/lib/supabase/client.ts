import { createBrowserClient } from '@supabase/ssr'

/**
 * Supabase client for Client Components. Uses the publishable key, so every
 * query runs under the signed-in user's RLS policies.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
