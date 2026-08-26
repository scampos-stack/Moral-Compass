'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Item = {
  href: string
  label: string
  hint: string
  /** Detail pages of the same subject, revealed when the branch is open. */
  children?: Item[]
}

/**
 * Grouped by where the number comes from, not by how many pages there are.
 *
 * Eleven flat entries meant scanning a list to find anything, and a new
 * section made it worse every time. Six branches, each opening only when you
 * are inside it: the closed sidebar answers "what areas exist", the open one
 * answers "what can I see about this area".
 */
const NAV: readonly Item[] = [
  { href: '/', label: 'Overview', hint: 'Revenue, ATW, insights' },
  {
    href: '/faire',
    label: 'Faire',
    hint: 'Promotions, migration',
    children: [
      {
        href: '/faire-campaigns',
        label: 'Faire campaigns',
        hint: 'Log email sends',
      },
    ],
  },
  {
    href: '/shopify',
    label: 'Shopify',
    hint: 'Direct, collections, UTM',
    // Campaign links reads Shopify's own session data — the same source, a
    // different question. Nested rather than promoted to the top level so
    // the sidebar keeps saying where a number comes from.
    children: [
      {
        href: '/shopify/campaigns',
        label: 'Campaign links',
        hint: 'Clicks, tagging, conversion',
      },
    ],
  },
  {
    href: '/outreach',
    label: 'Outreach',
    hint: 'All channels compared',
    // The four channel pages sit under the page that compares them. Read the
    // comparison first, then open the channel that looks wrong.
    children: [
      { href: '/woodpecker', label: 'Woodpecker', hint: 'Sequences, sentiment' },
      { href: '/pipelines', label: 'Pipelines', hint: 'GoHighLevel deals' },
      { href: '/social', label: 'Social', hint: 'Posts by platform' },
      { href: '/linkedin', label: 'LinkedIn entry', hint: 'Type daily numbers' },
    ],
  },
  { href: '/sync', label: 'Data', hint: 'Freshness, sync now' },
] as const

/**
 * Kept out of the main list on purpose. Everything above answers "how is the
 * business doing"; inventory answers "what do we have to buy" — a different
 * question for a different reader, and burying it among the revenue sections
 * would make it read as one more report rather than a to-do list.
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

  // A parent with children matches exactly, so opening a child does not light
  // up two rows at once and leave neither reading as "you are here".
  const isActive = (item: Item) =>
    item.href === '/' || item.children
      ? pathname === item.href
      : pathname.startsWith(item.href)

  const isOpen = (item: Item) =>
    isActive(item) ||
    (item.children ?? []).some((c) => pathname.startsWith(c.href))

  const link = (item: Item, nested = false) => {
    const active = isActive(item)
    const open = item.children ? isOpen(item) : false
    return (
      <Link
        key={item.href}
        href={`${item.href}${suffix}`}
        aria-current={active ? 'page' : undefined}
        aria-expanded={item.children ? open : undefined}
        className={
          'block rounded-none py-2 text-sm transition-colors ' +
          (nested ? 'px-3 md:pl-6 md:pr-3 ' : 'px-3 ') +
          (active
            ? 'bg-foreground text-background'
            : 'text-muted hover:bg-surface-muted hover:text-foreground')
        }
      >
        <span className="flex items-baseline justify-between gap-2">
          <span>
            {/* Stands in for the indent on the label itself, so the nesting
                survives even when the row is highlighted. */}
            {nested && (
              <span
                aria-hidden
                className={`mr-2 ${active ? 'text-background/50' : 'text-border'}`}
              >
                &#9500;
              </span>
            )}
            {item.label}
          </span>
          {/* A closed branch says how much is inside it, so nesting hides
              pages without hiding that they exist. */}
          {item.children && !open && (
            <span className="numeric text-[10px] text-muted">
              {item.children.length}
            </span>
          )}
        </span>
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

  const branch = (item: Item) =>
    item.children ? (
      <div key={item.href} className="contents md:block">
        {link(item)}
        {isOpen(item) && item.children.map((c) => link(c, true))}
      </div>
    ) : (
      link(item)
    )

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
        {NAV.map(branch)}
      </nav>

      <nav
        aria-label="Operations"
        className="flex flex-wrap gap-1 border-border px-3 pb-6 md:mx-3 md:flex-col md:border-t md:px-0 md:pt-4"
      >
        <p className="hidden px-3 pb-1 text-[10px] uppercase tracking-wider text-muted md:block">
          Operations
        </p>
        {OPS.map((i) => link(i))}
      </nav>
    </aside>
  )
}
