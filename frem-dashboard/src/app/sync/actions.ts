'use server'

import { revalidatePath } from 'next/cache'
import { isUnlocked } from '@/lib/edit-gate'
import { syncFaireOrders } from '@/lib/faire/sync'
import { syncWoodpecker } from '@/lib/woodpecker/sync'
import { syncGoHighLevel } from '@/lib/ghl/sync'
import { syncShopify } from '@/lib/shopify/sync'

export type SyncState = { ok: boolean; message: string } | null

/** Refreshes every page that reads synced data. */
function revalidateAll() {
  for (const p of [
    '/',
    '/faire',
    '/outreach',
    '/woodpecker',
    '/pipelines',
    '/social',
    '/sync',
  ]) {
    revalidatePath(p)
  }
}

/**
 * Runs one source, or all of them.
 *
 * Called directly rather than over HTTP: a server action already runs on the
 * server, so posting to our own API route would only add a round trip and a
 * second copy of the auth check.
 *
 * Faire is incremental — `since` covers the last 30 days rather than replaying
 * 11,000 orders on every click. Faire's own updated_at_min means an older
 * order edited recently is still picked up.
 */
export async function runSync(
  _prev: SyncState,
  formData: FormData
): Promise<SyncState> {
  if (!(await isUnlocked())) {
    return { ok: false, message: 'Enter the edit code to sync.' }
  }

  const source = String(formData.get('source') ?? 'all')
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString()

  const parts: string[] = []
  const failures: string[] = []

  async function step<T extends { ok: boolean; error?: string }>(
    name: string,
    fn: () => Promise<T>,
    describe: (r: T) => string
  ) {
    try {
      const r = await fn()
      if (r.ok) parts.push(`${name}: ${describe(r)}`)
      else failures.push(`${name}: ${r.error ?? 'failed'}`)
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (source === 'all' || source === 'faire') {
    await step(
      'Faire',
      () => syncFaireOrders({ updatedAtMin: sinceIso, maxPages: 100 }),
      (r) => `${r.orders} orders`
    )
  }
  if (source === 'all' || source === 'shopify') {
    await step(
      'Shopify',
      () => syncShopify({ maxPages: 20 }),
      (r) => `${r.directSales} direct, ${r.faireMirrors} mirrored`
    )
  }
  if (source === 'all' || source === 'woodpecker') {
    await step(
      'Woodpecker',
      () => syncWoodpecker(),
      (r) => `${r.campaigns} campaigns`
    )
  }
  if (source === 'all' || source === 'ghl') {
    await step(
      'GoHighLevel',
      () => syncGoHighLevel(),
      (r) => `${r.opportunities} opportunities`
    )
  }

  revalidateAll()

  // Partial success is reported as such — one dead source must not read as a
  // clean run, and the sources that did work should still say so.
  if (failures.length > 0) {
    return {
      ok: false,
      message:
        (parts.length ? `Done — ${parts.join(' · ')}. ` : '') +
        `Failed — ${failures.join(' · ')}`,
    }
  }
  return { ok: true, message: parts.join(' · ') || 'Nothing to sync.' }
}
