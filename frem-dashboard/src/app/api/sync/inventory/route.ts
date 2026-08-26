import { NextResponse, type NextRequest } from 'next/server'
import { syncShopifyInventory } from '@/lib/shopify/inventory'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

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

  const result = await syncShopifyInventory()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
