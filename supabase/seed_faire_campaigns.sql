-- Faire email campaigns, transcribed from Faire → Marketing → Campaigns
-- (read 2026-08-25). Starts at "4th July 1st", the first A-Teamwork send.
--
-- Faire exposes no marketing API, so this is hand-transcribed. Re-running
-- updates rather than duplicating.
--
-- Two things to know about these numbers:
--
-- 1. They accrue. An earlier screenshot showed "Game Day … customer only" at
--    34% open / 1 order / $1,548; the later one shows 37% / 5 orders / $2,453
--    for the same send. Faire keeps crediting orders after the send date, so
--    a freshly-sent campaign always looks worse than it will end up. Re-enter
--    recent campaigns after a few weeks rather than treating day-one numbers
--    as final.
--
-- 2. Five sends between Jun 29 and Jul 17 report 0 delivered of 0 attempted:
--    "4th July 1st", "4th July Last 26", "Pearls, coins & coastal charm",
--    and both "Collection-led - Pre sale" emails. They are marked Complete in
--    Faire but have no delivery data at all. Loaded as zeros because that is
--    what Faire reports — but zero delivered is not the same as zero
--    performance, and these should be checked in Faire before anyone reads
--    them as failed campaigns.

insert into faire_campaigns_manual (
  name, sent_on, status, recipients, attempted, delivered,
  open_rate_pct, click_rate_pct,
  orders_from_opens, orders_from_clicks,
  volume_from_opens, volume_from_clicks, notes
) values
  ('4th July 1st', '2026-06-29', 'Complete',
   'EMAIL-OKAY-TOTAL, Not signed up, Not yet ordered, Last ordered 180+ days ago, Active cart, Faire Direct eligible, Contacted, On Faire, Ordered',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'First A-Teamwork campaign. Faire reports no delivery data — verify in Faire.'),

  ('4th July Last 26', '2026-07-03', 'Complete',
   'Not yet ordered, Not signed up, Not on Faire-coco active, Faire Direct eligible, Contacted, Active cart, Faire Direct leads, EMAIL-OKAY-TOTAL, Mark Roopchan, On Faire',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('Pearls, coins & coastal charm — now at wholesale.', '2026-07-08', 'Complete',
   'Last ordered 60+ days ago, On Faire, Ordered, Active cart, Last ordered 180+ days ago, Faire Direct Eligible 051426',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('EMAIL 1 — Collection-led - Pre sale', '2026-07-15', 'Complete',
   'Faire Direct leads, Last ordered 180+ days ago, Eligible to claim Faire Direct offer, EMAIL-OKAY-TOTAL, Last ordered 60+ days ago, Active cart, Ordered',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('EMAIL 2 — Collection-led - Pre sale', '2026-07-17', 'Complete',
   'Not review yet, Last ordered 180+ days ago, Ordered, 3k, Last ordered 60+ days ago, Faire Direct leads',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('Untitled campaign 338', '2026-07-17', 'Complete',
   'Uncontacted',
   81, 73, 23.00, 0.00, 0, 0, 0, 0,
   'Tiny test send, 81 recipients.'),

  ('EMAIL 1 - Faire Event 20th (IF SENT ON 19TH)', '2026-07-20', 'Complete',
   'On Faire, Active cart, Ordered, Last ordered 180+ days ago, Last ordered 60+ days ago, Faire Direct leads',
   28453, 22214, 34.00, 0.40, 15, 1, 4726, 576,
   'Best revenue per recipient of any send so far.'),

  ('Faire event email 2', '2026-07-23', 'Complete',
   'ALL- Marketable (valid email)',
   79552, 48026, 26.00, 0.37, 1, 0, 69, 0,
   'Broad blast: highest reach, lowest return.'),

  ('After Faire Event 28/7', '2026-07-29', 'Complete',
   'Faire Direct leads, Uncontacted, Last ordered 180+ days ago, Faire Direct Eligible 051426, Mark Roopchan, Unused credit, Top Spenders Above $4,000, Not signed up, On Faire, Contacted, ALL-Marketable (valid email), Ordered, Marketable Abandoned Cart, EMAIL-OKAY-TOTAL, New Customers (<60 Days), Reorder Ready Customers, 3k, Eligible to claim Faire Direct offer, Not review yet, Last ordered 60+ days ago, Active cart, Not yet ordered',
   85894, 71417, 29.00, 0.41, 8, 3, 3017, 720,
   null),

  ('Back To School email 1 (regular collection + 30% off))', '2026-08-04', 'Complete',
   'All contacts',
   85692, 66838, 29.00, 0.35, 8, 1, 2085, 705,
   null),

  ('Back To School email 1 (regular collection + 30% off)) (Copy 347)', '2026-08-05', 'Complete',
   'Last ordered 60+ days ago, New Customers (<60 Days), Active cart, Marketable has ordered, Faire Direct leads, 3k, Ordered, Not review yet, Top Spenders Above $4,000, Unused credit, Last ordered 180+ days ago',
   3481, 2968, 38.00, 0.57, 6, 0, 1733, 0,
   'Segmented copy of the all-contacts send the day before — 38% vs 29% open.'),

  ('Game Day & 30% Off Clearance (August 10–11) 1', '2026-08-11', 'Complete',
   'All contacts',
   85492, 66504, 29.00, 0.28, 7, 0, 2772, 0,
   null),

  ('Game Day & 30% Off Clearance (August 10–11) " customer only', '2026-08-13', 'Complete',
   'Last ordered 60+ days ago, Ordered, Last ordered 180+ days ago, Active cart',
   3413, 2976, 37.00, 0.07, 5, 0, 2453, 0,
   'Same offer, segmented: 2,976 delivered produced $2,453 against $2,772 from 66,504.'),

  ('Beat the Q4 rush: Last-minute BTS stocking & Autumn preview', '2026-08-18', 'Complete',
   'All contacts',
   85270, 70683, 30.00, 0.30, 6, 0, 1386, 0,
   null),

  ('xclusive re-order preview: Fall trends + last call for BTS 30% off', '2026-08-20', 'Complete',
   'Unused credit, Faire Direct leads, Last ordered 180+ days ago, Faire Direct Leads 80, Active cart, Last ordered 60+ days ago, Faire Direct Potential List, Ordered',
   3477, 3029, 38.00, 0.63, 3, 0, 839, 0,
   'Recent — orders will still accrue.')

on conflict (name, sent_on, recipients) do update set
  status             = excluded.status,
  attempted          = excluded.attempted,
  delivered          = excluded.delivered,
  open_rate_pct      = excluded.open_rate_pct,
  click_rate_pct     = excluded.click_rate_pct,
  orders_from_opens  = excluded.orders_from_opens,
  orders_from_clicks = excluded.orders_from_clicks,
  volume_from_opens  = excluded.volume_from_opens,
  volume_from_clicks = excluded.volume_from_clicks,
  notes              = excluded.notes,
  updated_at         = now();
