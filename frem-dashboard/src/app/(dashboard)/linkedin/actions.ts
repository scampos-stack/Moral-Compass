'use server'

import { revalidatePath } from 'next/cache'
import { createReadClient } from '@/lib/supabase/read'
import { isUnlocked, unlock, lock } from '@/lib/edit-gate'

export type EntryState = { ok: boolean; message: string } | null

/** Exchanges the passcode for an edit cookie. */
export async function submitPasscode(
  _prev: EntryState,
  formData: FormData
): Promise<EntryState> {
  const ok = await unlock(String(formData.get('passcode') ?? ''))
  if (!ok) return { ok: false, message: 'Wrong code.' }
  revalidatePath('/linkedin')
  return { ok: true, message: 'Unlocked.' }
}

export async function lockEditing(): Promise<void> {
  await lock()
  revalidatePath('/linkedin')
}

function toInt(value: FormDataEntryValue | null): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/**
 * Upserts one day of LinkedIn activity. Upsert rather than insert so correcting
 * a day is the same action as entering it — the spreadsheet let people key the
 * same date twice, and nothing caught it.
 */
export async function saveLinkedInDay(
  _prev: EntryState,
  formData: FormData
): Promise<EntryState> {
  // Checked here, in the action, not just by hiding the form. A hidden form
  // stops nobody who can post to the endpoint directly.
  if (!(await isUnlocked())) {
    return { ok: false, message: 'Enter the edit code first.' }
  }

  const activityDate = String(formData.get('activity_date') ?? '')
  if (!activityDate) {
    return { ok: false, message: 'Pick a date.' }
  }

  const connectionsSent = toInt(formData.get('connections_sent'))
  const rawTotal = formData.get('network_total')
  const networkTotal =
    rawTotal === null || String(rawTotal).trim() === ''
      ? null
      : toInt(rawTotal)

  // The dashboard has no sign-in, so there is no user to attribute this to.
  const supabase = createReadClient()

  // Acceptances are the rise in network size since the last recorded total,
  // which is what the tracking sheet computed by hand. Derived here rather
  // than trusted from the client so the stored number cannot disagree with
  // the totals it came from.
  let connectionsAccepted = toInt(formData.get('connections_accepted'))
  if (networkTotal !== null) {
    const { data: prev } = await supabase
      .from('linkedin_daily')
      .select('network_total')
      .lt('activity_date', activityDate)
      .not('network_total', 'is', null)
      .order('activity_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    const previous = prev?.network_total ?? null
    // A falling total means disconnections, not negative acceptances.
    connectionsAccepted =
      previous === null ? 0 : Math.max(networkTotal - Number(previous), 0)
  }

  const { error } = await supabase.from('linkedin_daily').upsert(
    {
      activity_date: activityDate,
      connections_sent: connectionsSent,
      connections_accepted: connectionsAccepted,
      network_total: networkTotal,
      inmails: toInt(formData.get('inmails')),
      replies_positive: toInt(formData.get('replies_positive')),
      replies_neutral: toInt(formData.get('replies_neutral')),
      replies_negative: toInt(formData.get('replies_negative')),
      notes: (formData.get('notes') as string)?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'activity_date' }
  )

  if (error) {
    return { ok: false, message: error.message }
  }

  revalidatePath('/linkedin')
  return { ok: true, message: `Saved ${activityDate}.` }
}
