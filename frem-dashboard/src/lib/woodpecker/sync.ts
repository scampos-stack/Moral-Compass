import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Woodpecker REST v1.
 *
 * Verified against the live Frém account:
 *   - Auth is HTTP Basic with the API key as username and any password.
 *   - GET /campaign_list returns campaigns WITHOUT stats.
 *   - GET /campaign_list?id=<id> returns the same campaign WITH a `stats`
 *     object. Stats are lifetime cumulative counters, not per-day activity,
 *     so they are stored as a snapshot per campaign rather than appended.
 */

const BASE = process.env.WOODPECKER_API_BASE ?? 'https://api.woodpecker.co/rest/v1'

type WpStats = {
  prospects?: number
  sent?: number
  delivery?: number
  opened?: number
  clicked?: number
  replied?: number
  bounced?: number
  invalid?: number
  optout?: number
  interested?: number
  maybe_later?: number
  not_interested?: number
}

type WpCampaign = {
  id: number
  name: string
  status?: string
  from_email?: string
  created?: string
  stats?: WpStats
}

export type WoodpeckerResult = {
  ok: boolean
  campaigns: number
  sent: number
  replied: number
  error?: string
}

function authHeader() {
  const key = process.env.WOODPECKER_API_KEY
  if (!key) throw new Error('WOODPECKER_API_KEY is not set')
  // Basic auth: key as username, password ignored.
  return 'Basic ' + Buffer.from(`${key}:X`).toString('base64')
}

async function wpGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: authHeader() },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Woodpecker ${res.status} on ${path}: ${await res.text()}`)
  }
  return res.json()
}

/** Woodpecker sends "2026-05-05T00:00:00+0200" — no colon in the offset. */
function parseWpDate(raw?: string): string | null {
  if (!raw) return null
  const iso = raw.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function syncWoodpecker(): Promise<WoodpeckerResult> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'woodpecker' })
    .select('id')
    .single()

  const result: WoodpeckerResult = { ok: false, campaigns: 0, sent: 0, replied: 0 }

  try {
    const list = await wpGet<WpCampaign[]>('/campaign_list')

    const rows = []
    for (const c of list) {
      // The list endpoint omits stats; fetch each campaign individually.
      const detail = await wpGet<WpCampaign[]>(`/campaign_list?id=${c.id}`)
      const s = detail?.[0]?.stats ?? {}

      rows.push({
        id: c.id,
        name: c.name,
        status: c.status ?? null,
        from_email: c.from_email ?? null,
        created_at: parseWpDate(c.created),
        prospects: s.prospects ?? 0,
        sent: s.sent ?? 0,
        delivered: s.delivery ?? 0,
        opened: s.opened ?? 0,
        clicked: s.clicked ?? 0,
        replied: s.replied ?? 0,
        bounced: s.bounced ?? 0,
        invalid: s.invalid ?? 0,
        optout: s.optout ?? 0,
        interested: s.interested ?? 0,
        maybe_later: s.maybe_later ?? 0,
        not_interested: s.not_interested ?? 0,
        synced_at: new Date().toISOString(),
      })

      result.sent += s.sent ?? 0
      result.replied += s.replied ?? 0
    }

    if (rows.length > 0) {
      const { error } = await supabase
        .from('woodpecker_campaigns')
        .upsert(rows, { onConflict: 'id' })
      if (error) throw new Error(error.message)
    }

    result.campaigns = rows.length
    result.ok = true
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  if (run?.id) {
    await supabase
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: result.ok ? 'ok' : 'failed',
        rows_upserted: result.campaigns,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}
