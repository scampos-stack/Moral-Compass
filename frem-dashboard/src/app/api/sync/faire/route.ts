import { NextResponse, type NextRequest } from 'next/server'
import { syncFaireOrders } from '@/lib/faire/sync'

// Long-running: many paginated Faire calls plus upserts.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Triggers a Faire order sync.
 *
 * Guarded by CRON_SECRET rather than a user session so a scheduler can call
 * it. The route writes with the service-role key, so leaving it open would
 * hand anonymous callers an RLS bypass.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured' },
      { status: 500 }
    )
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const since = searchParams.get('since') ?? undefined
  const maxPages = Number(searchParams.get('max_pages') ?? 40)

  const result = await syncFaireOrders({
    updatedAtMin: since,
    maxPages: Number.isFinite(maxPages) ? maxPages : 40,
  })

  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
