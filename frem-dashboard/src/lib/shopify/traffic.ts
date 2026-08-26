import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Session data via ShopifyQL, which the REST order API cannot provide.
 *
 * Orders only reveal sessions that converted. When direct sales are two
 * orders, that means essentially all traffic is invisible — including every
 * campaign link someone clicked and did not buy from. ShopifyQL exposes
 * sessions, so clicks become measurable before they become revenue.
 *
 * Response shape was introspected rather than assumed:
 *   shopifyqlQuery -> ShopifyqlQueryResponse { parseErrors, tableData }
 *   tableData      -> ShopifyqlTableData     { columns { name }, rows }
 * `parseErrors` is a list of strings and is EMPTY on success — a bad column
 * name returns HTTP 200 with an error in there, never a failed request.
 */

const VERSION = process.env.SHOPIFY_API_VERSION ?? '2024-10'

export type TrafficResult = {
  ok: boolean
  rows: number
  sessions: number
  /** Rows in the 365-day monthly campaign series. */
  campaignRows: number
  error?: string
}

type Row = Record<string, string | null>

async function shopifyql(
  shop: string,
  token: string,
  query: string
): Promise<Row[]> {
  const res = await fetch(`https://${shop}/admin/api/${VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `{ shopifyqlQuery(query: ${JSON.stringify(query)}) {
        parseErrors
        tableData { columns { name } rows }
      } }`,
    }),
    cache: 'no-store',
  })

  if (!res.ok) throw new Error(`ShopifyQL ${res.status}: ${await res.text()}`)

  const body = (await res.json()) as {
    errors?: Array<{ message: string }>
    data?: {
      shopifyqlQuery?: {
        parseErrors?: string[]
        tableData?: { rows?: Row[] }
      }
    }
  }

  if (body.errors?.length) {
    throw new Error(`ShopifyQL: ${body.errors.map((e) => e.message).join('; ')}`)
  }
  const q = body.data?.shopifyqlQuery
  if (q?.parseErrors?.length) {
    // A 200 with parse errors is still a failure; surfacing it beats
    // returning an empty table that looks like "no traffic".
    throw new Error(`ShopifyQL: ${q.parseErrors.join('; ')}`)
  }
  return q?.tableData?.rows ?? []
}

const n = (v: string | null | undefined) => Number(v ?? 0) || 0
const s = (v: string | null | undefined) => (v == null || v === '' ? null : v)

export async function syncShopifyTraffic(
  shop: string,
  token: string,
  windowDays = 30
): Promise<TrafficResult> {
  const supabase = createAdminClient()
  const result: TrafficResult = { ok: false, rows: 0, sessions: 0, campaignRows: 0 }
  const since = `-${windowDays}d`

  try {
    const rows: Array<Record<string, unknown>> = []

    // Campaign links: source / medium / campaign.
    for (const r of await shopifyql(
      shop,
      token,
      `FROM sessions SHOW sessions GROUP BY utm_source, utm_medium, utm_campaign SINCE ${since} ORDER BY sessions DESC LIMIT 100`
    )) {
      rows.push({
        window_days: windowDays,
        utm_source: s(r.utm_source),
        utm_medium: s(r.utm_medium),
        utm_campaign: s(r.utm_campaign),
        referrer_name: null,
        referrer_source: null,
        landing_path: null,
        sessions: n(r.sessions),
        captured_at: new Date().toISOString(),
      })
    }

    // Where traffic came from, by named referrer.
    for (const r of await shopifyql(
      shop,
      token,
      `FROM sessions SHOW sessions GROUP BY referrer_name, referrer_source SINCE ${since} ORDER BY sessions DESC LIMIT 50`
    )) {
      rows.push({
        window_days: windowDays,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        referrer_name: s(r.referrer_name),
        referrer_source: s(r.referrer_source),
        landing_path: null,
        sessions: n(r.sessions),
        captured_at: new Date().toISOString(),
      })
    }

    // Which pages links actually land on.
    for (const r of await shopifyql(
      shop,
      token,
      `FROM sessions SHOW sessions GROUP BY landing_page_path SINCE ${since} ORDER BY sessions DESC LIMIT 50`
    )) {
      rows.push({
        window_days: windowDays,
        utm_source: null,
        utm_medium: null,
        utm_campaign: null,
        referrer_name: null,
        referrer_source: null,
        landing_path: s(r.landing_page_path),
        sessions: n(r.sessions),
        captured_at: new Date().toISOString(),
      })
    }

    // A twelve-month series by campaign, so an active link has a shape and
    // not just a total. Kept in its own table rather than as more rows in
    // shopify_sessions: that table is a point-in-time aggregate keyed by
    // window, and adding a month column to its unique constraint would
    // change the meaning of every row already in it.
    //
    // Empty string, never null, for the three utm columns — they are primary
    // key columns downstream, and a null in a key makes every upsert insert
    // a duplicate instead of updating.
    const series = (
      await shopifyql(
        shop,
        token,
        'FROM sessions SHOW sessions GROUP BY month, utm_campaign, utm_source, utm_medium SINCE -365d ORDER BY month DESC LIMIT 1000'
      )
    ).map((r) => ({
      month: String(r.month ?? '').slice(0, 10),
      utm_source: r.utm_source ?? '',
      utm_medium: r.utm_medium ?? '',
      utm_campaign: r.utm_campaign ?? '',
      sessions: n(r.sessions),
      captured_at: new Date().toISOString(),
    })).filter((r) => r.month.length === 10)

    for (let i = 0; i < series.length; i += 250) {
      const { error } = await supabase
        .from('shopify_campaign_sessions')
        .upsert(series.slice(i, i + 250), {
          onConflict: 'month,utm_source,utm_medium,utm_campaign',
        })
      if (error) throw new Error(`campaign series: ${error.message}`)
    }
    result.campaignRows = series.length
    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await supabase
        .from('shopify_sessions')
        .upsert(rows.slice(i, i + 250), {
          onConflict:
            'window_days,utm_source,utm_medium,utm_campaign,referrer_name,referrer_source,landing_path',
        })
      if (error) throw new Error(error.message)
    }

    result.rows = rows.length
    // Referrer rows partition all traffic, so they are the honest total —
    // summing every row would triple-count the same sessions across the
    // three groupings.
    result.sessions = rows
      .filter((r) => r.referrer_source !== null || r.referrer_name !== null)
      .reduce((a, r) => a + Number(r.sessions), 0)
    result.ok = true
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  return result
}
