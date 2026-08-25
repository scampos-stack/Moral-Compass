'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const NAV = [
  { href: '/', label: 'Overview', hint: 'Revenue, ATW, insights' },
  { href: '/faire', label: 'Faire', hint: 'Promotions, migration' },
  { href: '/outreach', label: 'Outreach', hint: 'Woodpecker, LinkedIn' },
  { href: '/pipelines', label: 'Pipelines', hint: 'GoHighLevel deals' },
  { href: '/social', label: 'Social', hint: 'Posts by platform' },
  { href: '/linkedin', label: 'LinkedIn entry', hint: 'Type daily numbers' },
] as const

export function Sidebar() {
  const pathname = usePathname()
  const params = useSearchParams()

  // Carry the selected timeline across sections so switching pages does not
  // silently reset the range you are reading.
  const qs = params.toString()
  const suffix = qs ? `?${qs}` : ''

  return (
    <aside className="w-full shrink-0 border-b border-border md:w-56 md:border-b-0 md:border-r">
      <div className="px-6 py-5">
        <p className="wordmark text-xs text-muted">Frém</p>
        <p className="text-base">Moral Compass</p>
      </div>

      <nav aria-label="Sections" className="flex flex-wrap gap-1 px-3 pb-4 md:flex-col">
        {NAV.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={`${item.href}${suffix}`}
              aria-current={active ? 'page' : undefined}
              className={
                'block rounded-none px-3 py-2 text-sm transition-colors ' +
                (active
                  ? 'bg-foreground text-background'
                  : 'text-muted hover:bg-surface-muted hover:text-foreground')
              }
            >
              <span className="block">{item.label}</span>
              <span
                className={
                  'hidden text-[10px] uppercase tracking-wider md:block ' +
                  (active ? 'text-background/60' : 'text-muted')
                }
              >
                {item.hint}
              </span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
