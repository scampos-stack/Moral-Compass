/**
 * Severities that mean "buy something".
 *
 * The rest — a line out of stock with nothing sold in sixty days, or one
 * merely worth watching — are decisions about whether to keep selling the
 * product at all, which is a different meeting with a different person.
 *
 * Shared by the page's headline stat and the board's tabs on purpose. When
 * they disagreed, the stat read 938 while the actual worklist was 261, and
 * the number a buyer plans their morning around was the wrong one.
 *
 * No 'use client' here so both a Server Component and a Client Component can
 * import it without pulling the board into the server bundle.
 */
export const ACTIONABLE: ReadonlySet<string> = new Set([
  'Oversold',
  'Out - still selling',
  'Critical',
  'Low',
])
