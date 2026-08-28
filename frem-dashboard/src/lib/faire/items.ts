import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Faire line items — what actually sold, by SKU, with dates.
 *
 * The order sync has always fetched these and thrown them away, which is why
 * SKU-level history began the day Shopify was connected rather than in 2023.
 *
 * Runs as its own source and is deliberately NOT part of "sync everything".
 * A full backfill walks ~234 pages; the incremental mode is cheap, but
 * neither belongs in a button someone clicks to refresh today's revenue.
 */

const BASE = process.env.FAIRE_API_BASE ?? 'https://www.faire.com/external-api/v2'

export type ItemsResult = {
  ok: boolean
  pages: number
  orders: number
  items: number
  /** Oldest and newest order dates reached, so a partial run is visible. */
  oldest: string | null
  newest: string | null
  /** Items whose SKU matches no Shopify variant — a mapping gap, not a bug. */
  unmatched: number
  error?: string
}

type FaireItem = {
  id: string
  sku?: string | null
  quantity?: number | null
  price_cents?: number | null
  product_name?: string | null
  variant_name?: string | null
  state?: string | null
}

type FaireOrder = {
  id: string
  created_at: string
  items?: FaireItem[]
}

const normKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')

/**
 * Faire rejects a limit outside [10, 50], and answers 400 rather than
 * clamping — learned the hard way asking for 1.
 */
const PAGE_SIZE = 50

export async function syncFaireItems(opts: {
  /** Pages to walk. 300 covers the whole history; 5 is a routine top-up. */
  maxPages?: number
} = {}): Promise<ItemsResult> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'faire_items' })
    .select('id')
    .single()

  const result: ItemsResult = {
    ok: false,
    pages: 0,
    orders: 0,
    items: 0,
    oldest: null,
    newest: null,
    unmatched: 0,
  }

  try {
    const token = process.env.FAIRE_ACCESS_TOKEN
    if (!token) throw new Error('FAIRE_ACCESS_TOKEN is not set')
    const H = { 'X-FAIRE-ACCESS-TOKEN': token, Accept: 'application/json' }

    const maxPages = opts.maxPages ?? 300
    const dates: string[] = []
    let batch: Array<Record<string, unknown>> = []

    const flush = async () => {
      if (batch.length === 0) return
      const { error } = await supabase
        .from('faire_line_items')
        .upsert(batch, { onConflict: 'id' })
      if (error) throw new Error(`upsert: ${error.message}`)
      batch = []
    }

    for (let page = 1; page <= maxPages; page++) {
      const res = await fetch(
        `${BASE}/orders?limit=${PAGE_SIZE}&page=${page}`,
        { headers: H, cache: 'no-store' }
      )
      if (!res.ok) {
        // A page failing mid-backfill should keep everything already written
        // rather than discarding 200 pages of work.
        result.error = `page ${page}: ${res.status} ${(await res.text()).slice(0, 120)}`
        break
      }

      const body = (await res.json()) as { orders?: FaireOrder[] }
      const orders = body.orders ?? []
      // An empty page is the end of the history, not an error.
      if (orders.length === 0) break

      result.pages = page
      result.orders += orders.length

      for (const o of orders) {
        dates.push(o.created_at)
        for (const it of o.items ?? []) {
          if (!it.id) continue
          batch.push({
            id: it.id,
            faire_order_id: o.id,
            ordered_at: o.created_at,
            sku: it.sku ?? null,
            product_name: it.product_name ?? null,
            variant_name: it.variant_name ?? null,
            quantity: it.quantity ?? 0,
            // Faire quotes money in cents; storing dollars keeps this
            // consistent with the orders table rather than requiring every
            // reader to remember which unit this one uses.
            price: (it.price_cents ?? 0) / 100,
            state: it.state ?? null,
            synced_at: new Date().toISOString(),
          })
          result.items += 1
        }
      }

      if (batch.length >= 500) await flush()
      // Courtesy pacing. A backfill is 234 requests and there is no reason
      // to make it look like an attack.
      await new Promise((r) => setTimeout(r, 250))
    }

    await flush()

    dates.sort()
    result.oldest = dates[0]?.slice(0, 10) ?? null
    result.newest = dates.at(-1)?.slice(0, 10) ?? null

    // How many distinct Faire SKUs found no home in the catalogue. Reported
    // rather than hidden: a join that quietly drops rows would understate
    // demand, and understated demand means an order never placed.
    //
    // Both sides are paged explicitly. PostgREST caps a request at 1,000
    // rows regardless of the limit asked for, so a single select would have
    // compared a slice against a slice and invented a match rate.
    const readKeys = async (table: string) => {
      const keys = new Set<string>()
      for (let from = 0; from < 40000; from += 1000) {
        const { data } = await supabase
          .from(table)
          .select('sku_key')
          .range(from, from + 999)
        if (!data?.length) break
        for (const r of data) {
          const k = (r as { sku_key: string | null }).sku_key
          if (k) keys.add(k)
        }
        if (data.length < 1000) break
      }
      return keys
    }

    const [known, seen] = await Promise.all([
      readKeys('shopify_inventory'),
      readKeys('faire_line_items'),
    ])
    result.unmatched = [...seen].filter((k) => !known.has(k)).length

    result.ok = !result.error
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  if (run?.id) {
    await supabase
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: result.ok ? 'ok' : 'failed',
        rows_upserted: result.items,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}

/** Exported for the normalisation check in tests and ad-hoc scripts. */
export { normKey }
