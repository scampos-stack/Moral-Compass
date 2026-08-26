-- Reorder tracking: a PO reference, an expected date, and proof of arrival.
--
-- ── The bug this fixes ───────────────────────────────────────────────────
--
-- inventory_reorder rows were only ever displayed by joining them onto
-- v_inventory_alerts, which lists variants that are LOW. The moment stock
-- arrives the variant stops being low, leaves that view, and takes its open
-- purchase order with it. The order is never closed, never chased, and the
-- one thing the buyer wanted to know — did it turn up — disappears exactly
-- when the answer becomes yes.
--
-- v_reorder_open below is keyed from inventory_reorder instead, so an open
-- order stays visible whatever the stock level does.
--
-- ── How arrival is detected ──────────────────────────────────────────────
--
-- The board previously guessed with "available > 5", which is wrong twice:
-- a line ordered at 4 that drifts to 6 on a returned unit reads as
-- delivered, and a line ordered at 40 for a big season never reads as
-- delivered at all. So the stock level at the moment of ordering is
-- recorded, and arrival means the count actually ROSE above it.
--
-- That is still inference, not proof — Shopify does not tell us why a number
-- changed, and a manual stock correction looks identical to a delivery.
-- Hence "stock rose, confirm receipt" rather than closing it automatically.
-- A human still says the goods landed.

alter table inventory_reorder
  add column if not exists po_number text,
  add column if not exists expected_at date,
  -- Units on hand when the order was placed. Null on rows created before
  -- this migration, and the view falls back to the current level for those,
  -- which reports no change rather than inventing an arrival.
  add column if not exists available_at_order integer;

create index if not exists inventory_reorder_expected_idx
  on inventory_reorder (expected_at) where status = 'ordered';

-- ── Open orders, independent of stock level ──────────────────────────────

drop view if exists v_reorder_open cascade;
create view v_reorder_open with (security_invoker = on) as
select
  r.variant_id,
  r.status,
  r.ordered_qty,
  r.ordered_at,
  r.expected_at,
  r.po_number,
  r.note,
  r.actor,
  r.available_at_order,

  i.product_title,
  i.variant_title,
  i.sku,
  i.available,
  i.product_status,

  coalesce(v.units_60d, 0)     as units_60d,
  coalesce(v.units_per_day, 0) as units_per_day,
  v.last_sold_at,

  -- Positive means the shelf has more on it than when the order was placed.
  (i.available - coalesce(r.available_at_order, i.available)) as stock_delta,

  -- Days past the expected date. Null when no date was given, in which case
  -- the board falls back to its five-day rule from the order date.
  case
    when r.expected_at is not null
      then (current_date - r.expected_at)
  end as days_late
from inventory_reorder r
join shopify_inventory i on i.variant_id = r.variant_id
left join v_inventory_velocity v on v.variant_id = r.variant_id
where r.status = 'ordered'
order by r.expected_at nulls last, r.ordered_at;

grant  select on v_reorder_open to authenticated;
revoke select on v_reorder_open from anon;
