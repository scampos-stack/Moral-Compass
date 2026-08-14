import 'server-only'

/**
 * Faire external API v2 client.
 *
 * Shapes below were verified against the live Frém account rather than taken
 * from documentation. Notable observed behaviour:
 *   - `limit` must be within [10, 50]; anything outside 400s.
 *   - Money is always minor units (`amount_minor`) plus a currency code.
 *   - `source` is MARKETPLACE or FAIRE_DIRECT, and commission_bps is 1500 or 0
 *     to match.
 *   - No buyer email is exposed anywhere in the payload.
 */

const FAIRE_MAX_LIMIT = 50

export type FaireMoney = { amount_minor: number; currency: string }

export type FairePayoutCosts = {
  commission_bps?: number
  commission?: FaireMoney
  total_payout?: FaireMoney
  subtotal_after_brand_discounts?: FaireMoney
}

export type FaireAddress = {
  company_name?: string
  name?: string
  city?: string
  state_code?: string
  country_code?: string
}

export type FaireOrder = {
  id: string
  display_id: string
  created_at: string
  updated_at: string
  state: string
  source: string
  retailer_id: string
  address?: FaireAddress
  customer?: { first_name?: string; last_name?: string }
  payout_costs?: FairePayoutCosts
}

type OrdersPage = {
  page: number
  limit: number
  cursor?: string
  orders: FaireOrder[]
}

export class FaireError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'FaireError'
  }
}

function config() {
  const token = process.env.FAIRE_ACCESS_TOKEN
  if (!token) throw new FaireError('FAIRE_ACCESS_TOKEN is not set', 500)
  return {
    token,
    base: process.env.FAIRE_API_BASE ?? 'https://www.faire.com/external-api/v2',
  }
}

async function getOrdersPage(params: {
  limit: number
  cursor?: string
  updatedAtMin?: string
}): Promise<OrdersPage> {
  const { token, base } = config()
  const url = new URL(`${base}/orders`)
  url.searchParams.set('limit', String(params.limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  if (params.updatedAtMin)
    url.searchParams.set('updated_at_min', params.updatedAtMin)

  const res = await fetch(url, {
    headers: { 'X-FAIRE-ACCESS-TOKEN': token },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new FaireError(
      `Faire ${res.status} on ${url.pathname}: ${await res.text()}`,
      res.status
    )
  }
  return res.json()
}

/**
 * Yields every order updated since `updatedAtMin`, one page at a time.
 *
 * `maxPages` is a hard stop, not a nicety: Frém has years of order history and
 * an unbounded loop against a paginated API is how a sync job becomes an
 * outage. The caller is told when the cap is hit so a truncated sync is never
 * mistaken for a complete one.
 */
export async function* iterateOrders(opts: {
  updatedAtMin?: string
  maxPages?: number
}): AsyncGenerator<{ orders: FaireOrder[]; page: number; truncated: boolean }> {
  const maxPages = opts.maxPages ?? 40
  let cursor: string | undefined
  let page = 0

  while (page < maxPages) {
    const data = await getOrdersPage({
      limit: FAIRE_MAX_LIMIT,
      cursor,
      updatedAtMin: opts.updatedAtMin,
    })
    page += 1

    const orders = data.orders ?? []
    if (orders.length === 0) return

    // A cursor is only meaningful if the page was full; a short page is the end.
    const more = Boolean(data.cursor) && orders.length === FAIRE_MAX_LIMIT
    yield { orders, page, truncated: more && page >= maxPages }

    if (!more) return
    cursor = data.cursor
  }
}

/** Minor units to a decimal string, exact — never via floating point. */
export function minorToDecimal(money?: FaireMoney): string {
  const minor = money?.amount_minor ?? 0
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor).toString().padStart(3, '0')
  return `${sign}${abs.slice(0, -2)}.${abs.slice(-2)}`
}
