'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUnlocked } from '@/lib/edit-gate'
import { currentUser } from '@/lib/session'

export type ActionState = { ok: boolean; message: string } | null

/**
 * Every write here answers "who did this". The passcode says an edit is
 * allowed; the signed-in email says by whom. Both are checked in the action
 * itself, not merely used to hide a button — hiding a control stops nobody
 * who can post to the endpoint.
 */
async function actor(): Promise<string | null> {
  if (!(await isUnlocked())) return null
  const user = await currentUser()
  return user?.email ?? null
}

function refresh() {
  revalidatePath('/inventory')
}

/** Records a purchase order against one variant. */
export async function markOrdered(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code to record an order.' }

  const variantId = Number(formData.get('variant_id'))
  if (!Number.isFinite(variantId)) {
    return { ok: false, message: 'Missing variant.' }
  }

  const raw = Number(formData.get('qty'))
  // A quantity of zero is a mis-click, not an order. Left null rather than
  // stored as 0, so "ordered, quantity unrecorded" stays distinguishable
  // from "ordered nothing".
  const qty = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null

  const expected = String(formData.get('expected_at') ?? '').trim()
  if (expected && !/^\d{4}-\d{2}-\d{2}$/.test(expected)) {
    return { ok: false, message: 'Expected date must be a real date.' }
  }

  const supabase = createAdminClient()

  // Read the shelf as it is right now, server-side rather than trusting a
  // number posted from the browser. This is the baseline every later
  // "has it arrived" check compares against, so a stale or edited value
  // would make deliveries appear or vanish.
  const { data: current } = await supabase
    .from('shopify_inventory')
    .select('available')
    .eq('variant_id', variantId)
    .maybeSingle()

  const { error } = await supabase.from('inventory_reorder').upsert(
    {
      variant_id: variantId,
      status: 'ordered',
      ordered_qty: qty,
      ordered_at: new Date().toISOString(),
      received_at: null,
      expected_at: expected || null,
      po_number: String(formData.get('po_number') ?? '').trim() || null,
      available_at_order: current?.available ?? null,
      actor: who,
      updated_at: new Date().toISOString(),
      note: String(formData.get('note') ?? '') || null,
    },
    { onConflict: 'variant_id' }
  )
  if (error) return { ok: false, message: error.message }

  refresh()
  return {
    ok: true,
    message:
      (qty ? `Ordered ${qty}` : 'Marked as ordered') +
      (expected ? `, expected ${expected}.` : '.'),
  }
}

/** Closes a purchase order once the goods land. */
export async function markReceived(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code first.' }

  const variantId = Number(formData.get('variant_id'))
  if (!Number.isFinite(variantId)) return { ok: false, message: 'Missing variant.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('inventory_reorder')
    .update({
      status: 'received',
      received_at: new Date().toISOString(),
      actor: who,
      updated_at: new Date().toISOString(),
    })
    .eq('variant_id', variantId)
  if (error) return { ok: false, message: error.message }

  refresh()
  return { ok: true, message: 'Marked received.' }
}

/**
 * Undoes a reorder record entirely.
 *
 * Deletes rather than setting a third status, because "open" is represented
 * by the absence of a row. A cancelled order that left a row behind would
 * keep the variant out of the main list forever.
 */
export async function clearReorder(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code first.' }

  const variantId = Number(formData.get('variant_id'))
  if (!Number.isFinite(variantId)) return { ok: false, message: 'Missing variant.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('inventory_reorder')
    .delete()
    .eq('variant_id', variantId)
  if (error) return { ok: false, message: error.message }

  refresh()
  return { ok: true, message: 'Back to open.' }
}

/**
 * Takes ownership of a naming problem.
 *
 * This does not close anything. The issue list is recomputed from Shopify on
 * every sync, so a claimed issue that has not actually been renamed comes
 * straight back — now showing who took it and how long ago. That is the
 * whole point: the only way to clear the row is to fix the data.
 */
export async function claimNaming(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code to claim.' }

  const scope = String(formData.get('scope') ?? '')
  const key = String(formData.get('norm_key') ?? '')
  if (!scope || !key) return { ok: false, message: 'Missing issue.' }

  const supabase = createAdminClient()
  const { error } = await supabase.from('naming_claim').upsert(
    {
      scope,
      norm_key: key,
      actor: who,
      claimed_at: new Date().toISOString(),
    },
    { onConflict: 'scope,norm_key' }
  )
  if (error) return { ok: false, message: error.message }

  refresh()
  return { ok: true, message: `Claimed by ${who}.` }
}

/** Hands a claimed naming issue back to the pile. */
export async function releaseNaming(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code first.' }

  const scope = String(formData.get('scope') ?? '')
  const key = String(formData.get('norm_key') ?? '')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('naming_claim')
    .delete()
    .eq('scope', scope)
    .eq('norm_key', key)
  if (error) return { ok: false, message: error.message }

  refresh()
  return { ok: true, message: 'Released.' }
}

/* ── Drill-down ──────────────────────────────────────────────────────── */

export type NamingItem = {
  typed_as: string
  sku: string | null
  product_title: string | null
  variant_title: string | null
  available: number
}

/**
 * The items behind one naming warning.
 *
 * Fetched on demand rather than with the page: the largest single issue
 * covers 3,693 variants, and shipping every issue's items up front would
 * mean tens of thousands of rows for a panel most of which stays collapsed.
 *
 * Read-only, so it is not behind the edit gate — seeing which SKUs need
 * renaming is exactly what someone should be able to do before they have
 * the code to claim it.
 */
export async function namingItems(
  scope: string,
  normKey: string,
  limit = 500
): Promise<NamingItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('v_naming_issue_items')
    .select('typed_as, sku, product_title, variant_title, available')
    .eq('scope', scope)
    .eq('norm_key', normKey)
    .limit(limit)
  if (error) return []
  return (data ?? []) as NamingItem[]
}

/* ── Hiding one variant ──────────────────────────────────────────────── */

/**
 * Takes a single colour or size out of the alert list.
 *
 * Two kinds, because "discontinued" describes the wrong thing for the case
 * this was built for: two of four colours in a summer style are empty and
 * meant to stay that way until spring, while the other two still sell.
 * Deactivating the product in Shopify would silence the two that work.
 *
 * A seasonal hide carries an end date and expires by itself. A hide with no
 * end date would bury that colour permanently and nobody would notice it
 * missing next May — the same failure as the noise it removes, only later.
 */
export async function hideVariant(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code to hide a line.' }

  const variantId = Number(formData.get('variant_id'))
  if (!Number.isFinite(variantId)) return { ok: false, message: 'Missing variant.' }

  const kind = String(formData.get('kind') ?? '')
  if (kind !== 'discontinued' && kind !== 'seasonal') {
    return { ok: false, message: 'Pick discontinued or out of season.' }
  }

  const until = String(formData.get('until') ?? '').trim()
  if (kind === 'seasonal') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) {
      return { ok: false, message: 'Out of season needs a return date.' }
    }
    // A date already past would hide nothing — the row would reappear on the
    // next render and read as though the click did not register.
    if (until < new Date().toISOString().slice(0, 10)) {
      return { ok: false, message: 'That date has already passed.' }
    }
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('variant_hidden').upsert(
    {
      variant_id: variantId,
      kind,
      until: kind === 'seasonal' ? until : null,
      reason: String(formData.get('reason') ?? '').trim() || null,
      actor: who,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'variant_id' }
  )
  if (error) return { ok: false, message: error.message }

  refresh()
  return {
    ok: true,
    message:
      kind === 'seasonal' ? `Hidden until ${until}.` : 'Marked discontinued.',
  }
}

/** Puts a hidden variant back in the list. */
export async function unhideVariant(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const who = await actor()
  if (!who) return { ok: false, message: 'Enter the edit code first.' }

  const variantId = Number(formData.get('variant_id'))
  if (!Number.isFinite(variantId)) return { ok: false, message: 'Missing variant.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('variant_hidden')
    .delete()
    .eq('variant_id', variantId)
  if (error) return { ok: false, message: error.message }

  refresh()
  return { ok: true, message: 'Back in the list.' }
}
