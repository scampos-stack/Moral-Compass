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
  const connectionsAccepted = toInt(formData.get('connections_accepted'))

  // Mirrors the accepted_within_sent CHECK constraint. Caught here so the user
  // gets a sentence instead of a Postgres error.
  if (connectionsAccepted > connectionsSent) {
    return {
      ok: false,
      message: `Accepted (${connectionsAccepted}) cannot exceed sent (${connectionsSent}).`,
    }
  }

  // The dashboard has no sign-in, so there is no user to attribute this to.
  const supabase = createReadClient()

  const { error } = await supabase.from('linkedin_daily').upsert(
    {
      activity_date: activityDate,
      connections_sent: connectionsSent,
      connections_accepted: connectionsAccepted,
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
