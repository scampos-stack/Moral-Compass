import 'server-only'
import { cookies } from 'next/headers'

/**
 * A small shared passcode that separates viewing from editing.
 *
 * Everyone can read the dashboard; only whoever knows the code can write the
 * LinkedIn numbers. This is deliberately modest — one shared secret, no user
 * accounts — and it is checked on the server in the action itself, not merely
 * used to hide the form. Hiding a form stops nobody who can open devtools.
 *
 * What it is not: real authentication. It does not identify who made an edit,
 * and anyone given the code can pass it on. It keeps honest people from
 * typing over each other's numbers, which is the actual problem here.
 */

const COOKIE = 'frem_edit'
const MAX_AGE = 60 * 60 * 12 // 12 hours — a working day, then re-enter.

function expected() {
  return process.env.EDIT_PASSCODE ?? '3008'
}

export async function isUnlocked(): Promise<boolean> {
  const jar = await cookies()
  return jar.get(COOKIE)?.value === expected()
}

export async function unlock(code: string): Promise<boolean> {
  if (code.trim() !== expected()) return false

  const jar = await cookies()
  jar.set(COOKIE, expected(), {
    httpOnly: true, // never readable from client JavaScript
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE,
    path: '/',
  })
  return true
}

export async function lock(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE)
}
