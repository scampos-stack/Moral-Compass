import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS entirely — use only in trusted server code
 * (cron jobs, webhooks, admin actions), never behind a user-controlled input
 * without your own authorization check first.
 */
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!secretKey) {
    throw new Error('SUPABASE_SECRET_KEY is not set')
  }

  return createSupabaseClient(process.env.SUPABASE_URL!, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
