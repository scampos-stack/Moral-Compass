import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GoHighLevel API v2 (services.leadconnectorhq.com).
 *
 * Verified against location GVBMFLmQCcxOfaxtJXHm:
 *   GET  /opportunities/pipelines?locationId=      pipelines + stages
 *   GET  /opportunities/search?location_id=        946 opps, 100 per page
 *   POST /social-media-posting/{loc}/posts/list    limit/skip must be STRINGS
 *
 * The Private Integration Token is scoped to one location and cannot discover
 * its own id, so GHL_LOCATION_ID has to be configured explicitly.
 */

const BASE = process.env.GHL_API_BASE ?? 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

export type GhlResult = {
  ok: boolean
  pipelines: number
  opportunities: number
  socialPosts: number
  error?: string
}

function config() {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN
  const location = process.env.GHL_LOCATION_ID
  if (!token) throw new Error('GHL_PRIVATE_INTEGRATION_TOKEN is not set')
  if (!location) throw new Error('GHL_LOCATION_ID is not set')
  return { token, location }
}

async function ghl<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const { token } = config()
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: VERSION,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`GHL ${res.status} on ${path}: ${await res.text()}`)
  }
  return res.json()
}

type Stage = { id: string; name: string; position?: number }
type Pipeline = { id: string; name: string; stages?: Stage[] }
type Opportunity = {
  id: string
  name?: string
  pipelineId?: string
  pipelineStageId?: string
  status?: string
  monetaryValue?: number
  source?: string
  createdAt?: string
  updatedAt?: string
  lastStatusChangeAt?: string
  contact?: {
    name?: string
    email?: string
    companyName?: string
  }
}

export async function syncGoHighLevel(): Promise<GhlResult> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'gohighlevel' })
    .select('id')
    .single()

  const result: GhlResult = {
    ok: false,
    pipelines: 0,
    opportunities: 0,
    socialPosts: 0,
  }

  try {
    const { location } = config()

    // ── Pipelines ────────────────────────────────────────────────────────
    const pipeRes = await ghl<{ pipelines?: Pipeline[] }>(
      `/opportunities/pipelines?locationId=${location}`
    )
    const pipelines = pipeRes.pipelines ?? []

    if (pipelines.length > 0) {
      const { error } = await supabase.from('ghl_pipelines').upsert(
        pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages ?? [],
          synced_at: new Date().toISOString(),
        })),
        { onConflict: 'id' }
      )
      if (error) throw new Error(`pipelines: ${error.message}`)
    }
    result.pipelines = pipelines.length

    // Stage id -> name, so opportunities carry a readable stage.
    const stageName = new Map<string, string>()
    for (const p of pipelines) {
      for (const s of p.stages ?? []) stageName.set(s.id, s.name)
    }

    // ── Opportunities ────────────────────────────────────────────────────
    // Offset pagination, hard-capped: 946 today, but an unbounded loop
    // against a growing CRM is how a sync becomes an outage.
    const rows = []
    for (let page = 0; page < 40; page++) {
      const data = await ghl<{ opportunities?: Opportunity[] }>(
        `/opportunities/search?location_id=${location}&limit=100&page=${page + 1}`
      )
      const batch = data.opportunities ?? []
      if (batch.length === 0) break

      for (const o of batch) {
        rows.push({
          id: o.id,
          name: o.name ?? null,
          pipeline_id: o.pipelineId ?? null,
          stage_id: o.pipelineStageId ?? null,
          stage_name: o.pipelineStageId
            ? (stageName.get(o.pipelineStageId) ?? null)
            : null,
          status: o.status ?? null,
          monetary_value: Number(o.monetaryValue ?? 0),
          source: o.source ?? null,
          contact_name: o.contact?.name ?? null,
          contact_email: o.contact?.email ?? null,
          contact_company: o.contact?.companyName ?? null,
          created_at: o.createdAt ?? null,
          updated_at: o.updatedAt ?? null,
          last_status_change_at: o.lastStatusChangeAt ?? null,
          synced_at: new Date().toISOString(),
        })
      }
      if (batch.length < 100) break
    }

    // Drop opportunities whose pipeline we did not fetch — the FK would
    // reject them and fail the whole batch.
    const known = new Set(pipelines.map((p) => p.id))
    const insertable = rows.filter((r) => r.pipeline_id && known.has(r.pipeline_id))

    for (let i = 0; i < insertable.length; i += 500) {
      const { error } = await supabase
        .from('ghl_opportunities')
        .upsert(insertable.slice(i, i + 500), { onConflict: 'id' })
      if (error) throw new Error(`opportunities: ${error.message}`)
    }
    result.opportunities = insertable.length

    // ── Social posts ─────────────────────────────────────────────────────
    // limit/skip must be strings here; numbers return 422.
    try {
      const social = await ghl<{
        results?: {
          posts?: Array<{
            _id: string
            platform?: string
            status?: string
            summary?: string
            accountId?: string
            displayDate?: string
            createdAt?: string
          }>
        }
      }>(`/social-media-posting/${location}/posts/list`, {
        method: 'POST',
        body: { type: 'all', limit: '100', skip: '0' },
      })

      const posts = social.results?.posts ?? []
      if (posts.length > 0) {
        const { error } = await supabase.from('ghl_social_posts').upsert(
          posts.map((p) => ({
            id: p._id,
            platform: p.platform ?? null,
            status: p.status ?? null,
            summary: p.summary?.slice(0, 500) ?? null,
            account_id: p.accountId ?? null,
            posted_at: p.displayDate ?? null,
            created_at: p.createdAt ?? null,
            synced_at: new Date().toISOString(),
          })),
          { onConflict: 'id' }
        )
        if (error) throw new Error(`social: ${error.message}`)
      }
      result.socialPosts = posts.length
    } catch (e) {
      // Social is secondary; a failure there must not lose the pipeline data
      // we already wrote. Recorded rather than swallowed.
      result.error = `social skipped: ${e instanceof Error ? e.message : String(e)}`
    }

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
        rows_upserted: result.opportunities,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}
