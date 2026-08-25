import 'server-only'
import { createReadClient } from '@/lib/supabase/read'
import { parseRange, resolveRange, type RangeKey } from '@/components/range-filter'

export type SearchParams = Promise<{
  range?: string
  from?: string
  to?: string
}>

export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const money0 = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })

export const num = (n: number) => n.toLocaleString('en-US')

export const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Number(n).toFixed(2)}%`

/** Resolves the timeline once, so every page reads the same window. */
export async function readRange(searchParams: SearchParams) {
  const sp = await searchParams
  const range: RangeKey = parseRange(sp.range)
  return {
    range,
    from: sp.from,
    to: sp.to,
    window: resolveRange(range, sp.from, sp.to),
  }
}

export type OrderRow = {
  amount: number
  commission: number
  payout: number
  placed_at: string
  channel: string
  rep: string | null
}

/**
 * Orders inside the window. Capped at 20k rows — the whole history is 11.6k
 * today, so this is headroom rather than a silent truncation, but the cap
 * exists so a runaway table cannot take the page down.
 */
export async function fetchOrders(w: {
  from: string | null
  to: string | null
}): Promise<OrderRow[]> {
  const supabase = createReadClient()
  let q = supabase
    .from('orders')
    .select(
      'amount, commission_paid, net_payout, placed_at, sales_channel, sales_rep_name'
    )
    .neq('state', 'cancelled')
  if (w.from) q = q.gte('placed_at', w.from)
  if (w.to) q = q.lt('placed_at', w.to)

  const { data } = await q.limit(20000)
  return (data ?? []).map((o) => ({
    amount: Number(o.amount),
    commission: Number(o.commission_paid ?? 0),
    payout: Number(o.net_payout ?? 0),
    placed_at: o.placed_at as string,
    channel: o.sales_channel as string,
    rep: (o.sales_rep_name as string | null) ?? null,
  }))
}

/** Totals plus the three-way rep split, all inside the selected window. */
export function summarise(orders: OrderRow[]) {
  const revenue = orders.reduce((s, o) => s + o.amount, 0)
  const commission = orders.reduce((s, o) => s + o.commission, 0)
  const payout = orders.reduce((s, o) => s + o.payout, 0)
  const direct = orders
    .filter((o) => o.channel !== 'faire_marketplace')
    .reduce((s, o) => s + o.amount, 0)

  const rep = { atw: 0, other: 0, untagged: 0 }
  const repOrders = { atw: 0, other: 0, untagged: 0 }
  for (const o of orders) {
    const k = o.rep === 'ATW' ? 'atw' : o.rep ? 'other' : 'untagged'
    rep[k] += o.amount
    repOrders[k] += 1
  }

  return {
    revenue,
    commission,
    payout,
    direct,
    directPct: revenue > 0 ? (100 * direct) / revenue : null,
    rep,
    repOrders,
    atwPct: revenue > 0 ? (100 * rep.atw) / revenue : null,
    orders: orders.length,
    avg: orders.length > 0 ? revenue / orders.length : 0,
  }
}

/** Groups orders into YYYY-MM buckets, oldest first, for the bar charts. */
export function byMonth(orders: OrderRow[]) {
  const m = new Map<string, { total: number; atw: number }>()
  for (const o of orders) {
    const k = o.placed_at.slice(0, 7)
    const e = m.get(k) ?? { total: 0, atw: 0 }
    e.total += o.amount
    if (o.rep === 'ATW') e.atw += o.amount
    m.set(k, e)
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, v]) => ({ label, value: v.total, sub: v.atw }))
}
