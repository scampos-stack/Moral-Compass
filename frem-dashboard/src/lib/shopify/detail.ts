import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Line items and collection membership.
 *
 * Split from the order sync because collections change rarely while orders
 * change constantly — and walking 122 collections on every order sync would
 * make the common case slow for no benefit.
 */

const VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10'

export type DetailResult = {
  ok: boolean
  lineItems: number
  collections: number
  memberships: number
  error?: string
}

type Collection = { id: number; title: string }

export async function syncShopifyCollections(
  shop: string,
  token: string
): Promise<{ collections: number; memberships: number }> {
  const supabase = createAdminClient()
  const H = { 'X-Shopify-Access-Token': token }

  const all: Array<Collection & { kind: string }> = []
  for (const kind of ['custom', 'smart'] as const) {
    const res = await fetch(
      `https://${shop}/admin/api/${VERSION}/${kind}_collections.json?limit=250`,
      { headers: H, cache: 'no-store' }
    )
    if (!res.ok) continue
    const key = `${kind}_collections`
    const body = (await res.json()) as Record<string, Collection[]>
    for (const c of body[key] ?? []) all.push({ ...c, kind })
  }

  const memberships: Array<{ product_id: number; collection_id: number }> = []
  const counts = new Map<number, number>()

  // One product listing per collection. Sequential on purpose: Shopify rate
  // limits at 2 calls/second on REST, and a burst here would 429 the whole
  // sync rather than merely being slower.
  for (const c of all) {
    const res = await fetch(
      `https://${shop}/admin/api/${VERSION}/collections/${c.id}/products.json?limit=250`,
      { headers: H, cache: 'no-store' }
    )
    if (!res.ok) continue
    const products = ((await res.json()) as { products?: Array<{ id: number }> })
      .products ?? []
    counts.set(c.id, products.length)
    for (const p of products) {
      memberships.push({ product_id: p.id, collection_id: c.id })
    }
  }

  if (all.length > 0) {
    await supabase.from('shopify_collections').upsert(
      all.map((c) => ({
        id: c.id,
        title: c.title,
        kind: c.kind,
        products: counts.get(c.id) ?? 0,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: 'id' }
    )
  }

  for (let i = 0; i < memberships.length; i += 500) {
    await supabase
      .from('shopify_product_collections')
      .upsert(memberships.slice(i, i + 500), {
        onConflict: 'product_id,collection_id',
      })
  }

  return { collections: all.length, memberships: memberships.length }
}
