import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Connection smoke test. Confirms the env vars resolve and Supabase Auth
 * answers — reachable without a session (see the middleware matcher).
 */
export async function GET() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getSession()

  return NextResponse.json({
    ok: !error,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    hasPublishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    hasSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY?.startsWith('sb_secret_')),
    session: data.session ? 'active' : 'none',
    error: error?.message ?? null,
  })
}
