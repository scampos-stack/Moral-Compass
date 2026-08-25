import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Shopify Admin API.
 *
 * Auth is OAuth client_credentials rather than a stored shpat_ token. The
 * app was created in Shopify's developer dashboard, not the store admin's
 * "Develop apps" section, so no permanent token is issuable — but the grant
 * below returns a working one, verified live.
 *
 * The token expires in 24h, so it is fetched per sync and never persisted.
 * That is strictly better than a permanent token: a leak expires on its own.
 *
 * Known limit: orders are capped at ~60 days without the read_all_orders
 * scope, which Shopify grants only on request. The store holds 11,545 orders;
 * roughly 700 are reachable. The sync reports how far back it actually got so
 * a partial window is never mistaken for the full history.
 */

const VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10'

export type ShopifyResult = {
  ok: boolean
  orders: number
  pages: number
  oldest: string | null
  newest: string | null
  windowLimited: boolean
  /** Orders Faire pushed into Shopify — mirrors, not direct sales. */
  faireMirrors: number
  directSales: number
  error?: string
}

function config() {
  const shop = process.env.SHOPIFY_SHOP
  const id = process.env.SHOPIFY_CLIENT_ID
  const secret = process.env.SHOPIFY_CLIENT_SECRET
  if (!shop) throw new Error('SHOPIFY_SHOP is not set')
  if (!id || !secret) {
    throw new Error('SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required')
  }
  return { shop, id, secret }
}

/** Exchanges client credentials for a short-lived access token. */
async function getToken(): Promise<string> {
  const { shop, id, secret } = config()
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`Shopify token ${res.status}: ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Shopify returned no access_token')
  return data.access_token
}

type ShopifyOrder = {
  id: number
  order_number?: number
  name?: string
  email?: string
  contact_email?: string
  company?: { name?: string } | null
  customer?: { first_name?: string; last_name?: string; email?: string } | null
  total_price?: string
  subtotal_price?: string
  total_discounts?: string
  currency?: string
  financial_status?: string
  fulfillment_status?: string | null
  cancelled_at?: string | null
  test?: boolean
  source_name?: string
  landing_site?: string | null
  referring_site?: string | null
  discount_codes?: Array<{ code?: string }>
  tags?: string
  created_at: string
  updated_at?: string
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

export async function syncShopify(opts: {
  maxPages?: number
}): Promise<ShopifyResult> {
  const supabase = createAdminClient()
  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'shopify' })
    .select('id')
    .single()

  const result: ShopifyResult = {
    ok: false,
    orders: 0,
    pages: 0,
    oldest: null,
    newest: null,
    windowLimited: false,
    faireMirrors: 0,
    directSales: 0,
  }

  try {
    const { shop } = config()
    const token = await getToken()
    const maxPages = opts.maxPages ?? 60

    let url: string | null =
      `https://${shop}/admin/api/${VERSION}/orders.json` +
      `?status=any&limit=250&order=created_at%20asc`

    const rows: Array<Record<string, unknown>> = []

    while (url && result.pages < maxPages) {
      const res: Response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token },
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error(`Shopify ${res.status} on orders: ${await res.text()}`)
      }

      const batch = ((await res.json()) as { orders?: ShopifyOrder[] }).orders ?? []
      result.pages += 1
      if (batch.length === 0) break

      for (const o of batch) {
        const name = [o.customer?.first_name, o.customer?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim()

        rows.push({
          id: o.id,
          order_number: o.order_number != null ? String(o.order_number) : null,
          name: o.name ?? null,
          // contact_email is populated on guest checkouts where customer is null.
          email: o.email ?? o.contact_email ?? o.customer?.email ?? null,
          customer_name: name || null,
          company: o.company?.name ?? null,
          total_price: o.total_price ?? '0',
          subtotal_price: o.subtotal_price ?? '0',
          total_discounts: o.total_discounts ?? '0',
          currency: o.currency ?? 'USD',
          financial_status: o.financial_status ?? null,
          fulfillment_status: o.fulfillment_status ?? null,
          cancelled_at: o.cancelled_at ?? null,
          test: Boolean(o.test),
          source_name: o.source_name ?? null,
          landing_site: o.landing_site ?? null,
          referring_site: o.referring_site ?? null,
          discount_codes: (o.discount_codes ?? [])
            .map((d) => d.code?.trim())
            .filter((c): c is string => Boolean(c)),
          tags: o.tags ?? null,
          placed_at: o.created_at,
          updated_at: o.updated_at ?? null,
          synced_at: new Date().toISOString(),
        })
      }

      url = nextPageUrl(res.headers.get('link'))
    }

    // Hitting the page cap means there is more history we did not fetch.
    if (url) result.windowLimited = true

    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await supabase
        .from('shopify_orders')
        .upsert(rows.slice(i, i + 250), { onConflict: 'id' })
      if (error) throw new Error(`upsert: ${error.message}`)
    }

    // Counted here so the sync result itself shows the split: Faire mirrors
    // every marketplace order into Shopify, and counting them as direct sales
    // would double the entire business.
    for (const r of rows) {
      const src = String(r.source_name ?? '').toLowerCase()
      const tags = String(r.tags ?? '').toLowerCase()
      if (src === 'faire' || tags.includes('faire')) result.faireMirrors += 1
      else if (src !== 'shopify_draft_order' && !r.test && !r.cancelled_at) {
        result.directSales += 1
      }
    }

    result.orders = rows.length
    const dates = rows.map((r) => String(r.placed_at)).sort()
    result.oldest = dates[0] ?? null
    result.newest = dates.at(-1) ?? null
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
        rows_upserted: result.orders,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}
