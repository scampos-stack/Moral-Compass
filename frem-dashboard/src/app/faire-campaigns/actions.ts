'use server'

import { revalidatePath } from 'next/cache'
import { createReadClient } from '@/lib/supabase/read'
import { isUnlocked } from '@/lib/edit-gate'

export type CampaignState = { ok: boolean; message: string } | null

function toInt(v: FormDataEntryValue | null): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function toMoney(v: FormDataEntryValue | null): number {
  // Tolerates "$1,548" pasted straight from the Faire screen.
  const raw = String(v ?? '').replace(/[$,\s]/g, '')
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function toPct(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? '').replace(/[%\s]/g, '')
  if (raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

export async function saveFaireCampaign(
  _prev: CampaignState,
  formData: FormData
): Promise<CampaignState> {
  if (!(await isUnlocked())) {
    return { ok: false, message: 'Enter the edit code first.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  const sentOn = String(formData.get('sent_on') ?? '')
  if (!name) return { ok: false, message: 'Campaign name is required.' }
  if (!sentOn) return { ok: false, message: 'Pick the date it was sent.' }

  const attempted = toInt(formData.get('attempted'))
  const delivered = toInt(formData.get('delivered'))

  // Faire shows "2,976 / 3,413" — delivered over attempted. Delivered can
  // never exceed attempted, and catching it here beats a Postgres error.
  if (attempted > 0 && delivered > attempted) {
    return {
      ok: false,
      message: `Delivered (${delivered}) cannot exceed attempted (${attempted}).`,
    }
  }

  const supabase = createReadClient()
  const { error } = await supabase.from('faire_campaigns_manual').upsert(
    {
      name,
      sent_on: sentOn,
      status: String(formData.get('status') ?? '').trim() || null,
      recipients: String(formData.get('recipients') ?? '').trim() || null,
      attempted,
      delivered,
      open_rate_pct: toPct(formData.get('open_rate_pct')),
      click_rate_pct: toPct(formData.get('click_rate_pct')),
      orders_from_opens: toInt(formData.get('orders_from_opens')),
      orders_from_clicks: toInt(formData.get('orders_from_clicks')),
      volume_from_opens: toMoney(formData.get('volume_from_opens')),
      volume_from_clicks: toMoney(formData.get('volume_from_clicks')),
      creative_type:
        String(formData.get('creative_type') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    // Same campaign, same day, same audience is the same entry.
    { onConflict: 'name,sent_on,recipients' }
  )

  if (error) return { ok: false, message: error.message }

  revalidatePath('/faire-campaigns')
  revalidatePath('/faire')
  return { ok: true, message: `Saved “${name}”.` }
}

export async function deleteFaireCampaign(formData: FormData): Promise<void> {
  if (!(await isUnlocked())) return
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const supabase = createReadClient()
  await supabase.from('faire_campaigns_manual').delete().eq('id', id)
  revalidatePath('/faire-campaigns')
  revalidatePath('/faire')
}
