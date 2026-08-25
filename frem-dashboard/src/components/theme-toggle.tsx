'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

const KEY = 'frem-theme'

/**
 * Cycles light → dark → system.
 *
 * "System" is a real third state, not a synonym for one of the others: it
 * removes the attribute so the OS preference applies and keeps applying when
 * it changes during the day.
 *
 * Reads and writes are wrapped in try/catch — localStorage throws outright in
 * some contexts (private windows, blocked site data), and a theme control must
 * never be the reason a page fails to render.
 */
function apply(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  // The inline script in <head> has already set the attribute; this only
  // syncs the button label once React takes over.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY)
      if (saved === 'light' || saved === 'dark') setTheme(saved)
    } catch {
      /* keep the default */
    }
  }, [])

  function cycle() {
    const next: Theme =
      theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next)
    apply(next)
  }

  const label = theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'Auto'

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${label}. Click to change.`}
      aria-label={`Theme: ${label}. Click to change.`}
      className="border border-border px-3 py-1.5 text-xs uppercase tracking-wider text-muted transition-colors hover:border-foreground hover:text-foreground"
    >
      {label}
    </button>
  )
}

/**
 * Runs before first paint so a dark-mode user never sees a white flash.
 * Injected as a raw string because it must execute before React hydrates.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})()`
