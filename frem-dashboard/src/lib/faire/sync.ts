import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  iterateOrders,
  minorToDecimal,
  type FaireOrder,
} from './client'

export type SyncResult = {
  ok: boolean
  pages: number
  retailers: number
  orders: number
  truncated: boolean
  error?: string
}

/** Faire's states, collapsed to ours. Unknown values fall back to 'pending'. */
function mapState(raw: string) {
  switch (raw.toUpperCase()) {
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled'
    case 'DELIVERED':
      return 'delivered'
    case 'IN_TRANSIT':
      return 'in_transit'
    case 'PROCESSING':
      return 'processing'
    default:
      return 'pending'
  }
}

function mapChannel(source: string) {
  return source.toUpperCase() === 'FAIRE_DIRECT'
    ? 'faire_direct'
    : 'faire_marketplace'
}

/** Best available name for a Faire buyer: store name first, person second. */
function retailerName(order: FaireOrder) {
  const company = order.address?.company_name?.trim()
  if (company) return company
  const person = [order.customer?.first_name, order.customer?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  return person || `Faire retailer ${order.retailer_id}`
}

/**
 * Pulls Faire orders into Supabase.
 *
 * Runs with the service-role client because it writes to tables whose RLS
 * permits reads only. Idempotent: retailers upsert on faire_retailer_id and
 * orders on faire_order_id, so re-running re-syncs rather than duplicating.
 */
export async function syncFaireOrders(opts: {
  updatedAtMin?: string
  maxPages?: number
}): Promise<SyncResult> {
  const supabase = createAdminClient()

  const { data: run } = await supabase
    .from('sync_runs')
    .insert({ source: 'faire' })
    .select('id')
    .single()

  const result: SyncResult = {
    ok: false,
    pages: 0,
    retailers: 0,
    orders: 0,
    truncated: false,
  }

  try {
    for await (const batch of iterateOrders(opts)) {
      result.pages = batch.page
      if (batch.truncated) result.truncated = true

      // Retailers first — orders carry a NOT NULL FK to them.
      const retailers = new Map<string, string>()
      for (const o of batch.orders) {
        if (!retailers.has(o.retailer_id)) {
          retailers.set(o.retailer_id, retailerName(o))
        }
      }

      const { data: retailerRows, error: retailerError } = await supabase
        .from('retailers')
        .upsert(
          [...retailers].map(([faire_retailer_id, name]) => ({
            faire_retailer_id,
            name,
          })),
          { onConflict: 'faire_retailer_id' }
        )
        .select('id, faire_retailer_id')

      if (retailerError) throw new Error(`retailers: ${retailerError.message}`)
      result.retailers += retailerRows?.length ?? 0

      const idByFaireId = new Map(
        (retailerRows ?? []).map((r) => [r.faire_retailer_id, r.id])
      )

      const orderRows = batch.orders.flatMap((o) => {
        const retailer_id = idByFaireId.get(o.retailer_id)
        // Should not happen — the upsert above covers every retailer in the
        // batch — but skipping beats throwing on a NOT NULL violation.
        if (!retailer_id) return []

        const pc = o.payout_costs
        const state = mapState(o.state)

        return [
          {
            faire_order_id: o.id,
            display_id: o.display_id,
            retailer_id,
            placed_at: o.created_at,
            amount: minorToDecimal(pc?.subtotal_after_brand_discounts),
            currency: pc?.subtotal_after_brand_discounts?.currency ?? 'USD',
            state,
            raw_state: o.state,
            is_confirmed: state === 'delivered',
            sales_channel: mapChannel(o.source),
            raw_source: o.source,
            commission_rate: (pc?.commission_bps ?? 0) / 10000,
            commission_paid: minorToDecimal(pc?.commission),
            net_payout: minorToDecimal(pc?.total_payout),
          },
        ]
      })

      if (orderRows.length > 0) {
        const { error: orderError } = await supabase
          .from('orders')
          .upsert(orderRows, { onConflict: 'faire_order_id' })
        if (orderError) throw new Error(`orders: ${orderError.message}`)
        result.orders += orderRows.length
      }
    }

    // New retailers may match existing Woodpecker prospects by company name.
    await supabase.rpc('link_prospects_to_retailers')
    await supabase.rpc('attribute_orders', {
      window_hours: Number(process.env.ATTRIBUTION_WINDOW_HOURS ?? 72),
    })

    result.ok = true
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e)
  }

  if (run?.id) {
    await supabase
      .from('sync_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: result.ok ? (result.truncated ? 'truncated' : 'ok') : 'failed',
        rows_upserted: result.orders,
        error: result.error ?? null,
      })
      .eq('id', run.id)
  }

  return result
}
