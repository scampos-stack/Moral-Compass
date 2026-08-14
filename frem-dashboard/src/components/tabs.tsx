'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/linkedin', label: 'LinkedIn' },
] as const

/**
 * Persistent tab bar. Lives in the root layout so every page carries it —
 * there is no screen you can reach and not navigate away from.
 */
export function Tabs() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Sections"
      className="flex gap-6 border-b border-border px-8"
    >
      {TABS.map((tab) => {
        const active =
          tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={
              '-mb-px border-b-2 py-3 text-xs uppercase tracking-wider transition-colors ' +
              (active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted hover:text-foreground')
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
