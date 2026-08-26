import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { config, getToken } from './sync'

/**
 * Stock on hand, per variant.
 *
 * Its own sync source rather than a step inside syncShopify, for two
 * reasons. Orders are read on a 60-day window and change constantly;
 * the catalogue is 3,571 products and changes rarely, so pinning them
 * together would make the frequent job pay for the rare one. And a buyer
 * checking reorders needs to know when the *stock* was last read — a
 * freshness row that actually means orders would mislead exactly the
 * person who can least afford it.
 *
 * Quantities come from the variant payload, not /inventory_levels.json.
 * The app lacks read_locations (403), and the store is single-location, so
 * variant.inventory_quantity is the same number with one call instead of
 * one per item.
 */

const VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10'

export type InventoryResult = {
  ok: boolean
  products: number
  variants: number
  /** Active, Shopify-tracked variants at or below the low-stock line. */
  lowStock: number
  outOfStock: number
  oversold: number
  /** Distinct values typed more than one way. The client-hygiene warning. */
  namingIssues: number
  duplicateSkus: number
  error?: string
}

type Variant = {
  id: number
  product_id: number
  title?: string | null
  sku?: string | null
  price?: string | null
  option1?: string | null
  option2?: string | null
  option3?: string | null
  inventory_item_id?: number | null
  inventory_management?: string | null
  inventory_policy?: string | null
  inventory_quantity?: number | null
  updated_at?: string | null
}

type Product = {
  id: number
  title?: string | null
  vendor?: string | null
  status?: string | null
  variants?: Variant[]
}

/** Shopify paginates via a `Link` header, not a body cursor. */
function nextPageUrl(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const [urlPart, relPart] = part.split(';')
    if (relPart?.includes('rel="next"')) {
      return urlPart.trim().replace(/^<|>$/g, '')
    }
  }
  return null
}

/**
 * The same normalisation the database applies to sku_key, so the counts
 * this function reports match what the hygiene views will show.
 */
const normKey = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

export async function syncShopifyInventory(): Promise<InventoryResult> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'shopify_inventory' })
    .select('id')
    .single()

  const result: InventoryResult = {
    ok: false,
    products: 0,
    variants: 0,
    lowStock: 0,
    outOfStock: 0,
    oversold: 0,
    namingIssues: 0,
    duplicateSkus: 0,
  }

  try {
    const { shop } = config()
    const token = await getToken()
    const H = { 'X-Shopify-Access-Token': token }

    // No status filter, which returns active, archived and draft alike.
    // Archived products are excluded from every alert but must still be
    // stored: they hold units, and a SKU collision with an archived item is
    // still a collision. Note that status=any — valid on orders.json — is
    // NOT valid here: products.json accepts only a single concrete status
    // and answers 200 with zero products for anything else, so a wrong value
    // reads as an empty catalogue rather than an error. Verified live.
    let url: string | null =
      `https://${shop}/admin/api/${VERSION}/products.json` +
      `?limit=250&fields=id,title,vendor,status,variants`

    const products: Product[] = []
    // 3,571 products at 250 a page is 15 calls. The cap is headroom, not a
    // truncation — but it exists so a catalogue that doubles cannot hang the
    // request forever.
    for (let page = 0; url && page < 40; page++) {
      const res: Response = await fetch(url, { headers: H, cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`products ${res.status}: ${(await res.text()).slice(0, 200)}`)
      }
      const body = (await res.json()) as { products?: Product[] }
      products.push(...(body.products ?? []))
      url = nextPageUrl(res.headers.get('link'))
      // REST allows 2 calls/second. Bursting here would 429 the whole sync
      // rather than merely being slower.
      if (url) await new Promise((r) => setTimeout(r, 600))
    }
    result.products = products.length

    const rows = products.flatMap((p) =>
      (p.variants ?? []).map((v) => ({
        variant_id: v.id,
        product_id: p.id,
        inventory_item_id: v.inventory_item_id ?? null,
        product_title: p.title ?? null,
        variant_title: v.title ?? null,
        vendor: p.vendor ?? null,
        product_status: p.status ?? null,
        sku: v.sku ?? null,
        option1: v.option1 ?? null,
        option2: v.option2 ?? null,
        option3: v.option3 ?? null,
        price: Number(v.price ?? 0),
        available: v.inventory_quantity ?? 0,
        inventory_management: v.inventory_management ?? null,
        inventory_policy: v.inventory_policy ?? null,
        variant_updated_at: v.updated_at ?? null,
        synced_at: new Date().toISOString(),
      }))
    )
    result.variants = rows.length

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase
        .from('shopify_inventory')
        .upsert(rows.slice(i, i + 500), { onConflict: 'variant_id' })
      if (error) throw new Error(`upsert: ${error.message}`)
    }

    // Counted here so the sync message itself carries the headline. Active
    // and tracked only — archived stock reads as zero and would report a
    // catalogue-wide stockout that is not real.
    const live = rows.filter(
      (r) => r.product_status === 'active' && r.inventory_management === 'shopify'
    )
    for (const r of live) {
      if (r.available < 0) result.oversold += 1
      else if (r.available === 0) result.outOfStock += 1
      else if (r.available <= 5) result.lowStock += 1
    }

    // Hygiene, computed on the same pass. Groups every typed value by its
    // normalised form and counts the groups holding more than one spelling.
    const spellings = new Map<string, Set<string>>()
    const add = (scope: string, raw: string | null) => {
      const v = (raw ?? '').trim()
      if (!v) return
      const nk = normKey(v)
      // A value of nothing but punctuation normalises to empty and would
      // group every such value into one false collision.
      if (!nk) return
      const k = scope + ':' + nk
      if (!spellings.has(k)) spellings.set(k, new Set())
      spellings.get(k)!.add(v)
    }
    const skuOwners = new Map<string, Set<number>>()
    for (const r of rows) {
      if (r.product_status !== 'active') continue
      add('title', r.product_title)
      add('option', r.option1)
      add('option', r.option2)
      add('option', r.option3)
      add('vendor', r.vendor)
      add('sku', r.sku)

      const sku = (r.sku ?? '').trim()
      if (sku) {
        const k = sku.toUpperCase().replace(/[^A-Z0-9]+/g, '')
        if (!skuOwners.has(k)) skuOwners.set(k, new Set())
        skuOwners.get(k)!.add(r.variant_id)
      }
    }
    for (const set of spellings.values()) {
      if (set.size > 1) result.namingIssues += 1
    }
    for (const owners of skuOwners.values()) {
      if (owners.size > 1) result.duplicateSkus += 1
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
        rows_upserted: result.variants,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}
