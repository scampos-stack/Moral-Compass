import { NextResponse, type NextRequest } from 'next/server'
import { syncFaireItems } from '@/lib/faire/items'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Line items, on demand.
 *
 * `?pages=` controls depth: the default 5 is a top-up, 300 walks the whole
 * history. The backfill is run once from here rather than from a button,
 * since 234 sequential requests outlast a page someone is watching.
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

  const raw = Number(new URL(request.url).searchParams.get('pages') ?? 5)
  const maxPages = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 400) : 5

  const result = await syncFaireItems({ maxPages })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
