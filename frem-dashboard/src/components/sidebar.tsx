'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Item = { href: string; label: string; hint: string }

const NAV: readonly Item[] = [
  { href: '/', label: 'Overview', hint: 'Revenue, ATW, insights' },
  { href: '/faire', label: 'Faire', hint: 'Promotions, migration' },
  { href: '/shopify', label: 'Shopify', hint: 'Direct, collections, UTM' },
  { href: '/outreach', label: 'Outreach', hint: 'All channels compared' },
  { href: '/campaigns', label: 'Campaign links', hint: 'Clicks, tagging, conversion' },
  { href: '/woodpecker', label: 'Woodpecker', hint: 'Sequences, sentiment' },
  { href: '/faire-campaigns', label: 'Faire campaigns', hint: 'Log email sends' },
  { href: '/pipelines', label: 'Pipelines', hint: 'GoHighLevel deals' },
  { href: '/social', label: 'Social', hint: 'Posts by platform' },
  { href: '/linkedin', label: 'LinkedIn entry', hint: 'Type daily numbers' },
  { href: '/sync', label: 'Data', hint: 'Freshness, sync now' },
] as const

/**
 * Kept out of the main list on purpose. Everything above answers "how is the
 * business doing"; inventory answers "what do we have to buy" — a different
 * question for a different reader, and burying it in the middle of the
 * revenue sections would make it read as one more report rather than a
 * to-do list.
 */
const OPS: readonly Item[] = [
  { href: '/inventory', label: 'Inventory', hint: 'Stock, reorder, warnings' },
] as const

export function Sidebar() {
  const pathname = usePathname()
  const params = useSearchParams()

  // Carry the selected timeline across sections so switching pages does not
  // silently reset the range you are reading.
  const qs = params.toString()
  const suffix = qs ? `?${qs}` : ''

  const link = (item: Item) => {
    const active =
      item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
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
  }

  return (
    // Sticky and self-scrolling on desktop, so navigation stays reachable no
    // matter how far down a long table you are. `self-start` keeps the flex
    // item from stretching, which would otherwise defeat `sticky`.
    <aside className="w-full shrink-0 border-b border-border md:sticky md:top-0 md:h-screen md:w-56 md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
      <div className="px-6 py-5">
        <p className="wordmark text-xs text-muted">Frém</p>
        <p className="text-base">Moral Compass</p>
      </div>

      <nav aria-label="Sections" className="flex flex-wrap gap-1 px-3 pb-4 md:flex-col">
        {NAV.map(link)}
      </nav>

      <nav
        aria-label="Operations"
        className="flex flex-wrap gap-1 border-border px-3 pb-6 md:mx-3 md:flex-col md:border-t md:px-0 md:pt-4"
      >
        <p className="hidden px-3 pb-1 text-[10px] uppercase tracking-wider text-muted md:block">
          Operations
        </p>
        {OPS.map(link)}
      </nav>
    </aside>
  )
}
