-- Inventory: stock on hand, reorder pressure, and catalogue hygiene.
--
-- Verified live against fremnyc.myshopify.com before writing any of this:
--
--   Scopes granted include read_products and read_inventory, so variant
--   stock is readable today with the credentials already in .env.local.
--   read_locations is NOT granted (403 on /locations.json). It is not
--   needed: variants carry inventory_quantity directly, and the store
--   reports a single location, so there is nothing to split by.
--
--   The catalogue is 3,571 products / 7,527 variants, of which 5,360 are
--   active. Total on hand is 737,602 units.
--
--   Active stock today: 18 negative, 780 at zero, 171 between 1 and 5.
--   The 1-5 band is the reorder list; the negatives are a data fault, not
--   a reorder (Shopify only goes below zero when something was sold that
--   the system did not know it had).
--
-- THE HYGIENE PROBLEM, measured rather than assumed. The same value is
-- typed different ways on different products, so grouping by name splits
-- one thing into several:
--
--   Option values   20 collisions  "One"/"ONE", "Pink"/"PINK",
--                                  "Burgundy"/"BURGUNDY",
--                                  "Blue Flower"/"Blue / Flower"/"Blue/Flower"
--   Product titles   6 collisions  "Seed Bead Anklet"/"SEED BEAD ANKLET"
--   Vendor           1 collision   "Frem"/"FREM"
--   SKU              1 collision   "m-5SK51011-BL-ONE"/"M-5SK51011-BL-ONE"
--
-- And separately, 228 SKUs are attached to more than one active variant.
-- That one matters most for a two-store rollup: if a SKU is not unique
-- inside a single store, joining two stores on it silently merges
-- unrelated products and reports stock that does not exist.

create table if not exists shopify_inventory (
  variant_id        bigint primary key,
  product_id        bigint not null,
  inventory_item_id bigint,

  product_title     text,
  variant_title     text,
  vendor            text,
  product_status    text,               -- active | archived | draft

  sku               text,
  -- Case- and punctuation-insensitive SKU. This is the column any
  -- cross-store join must use: "m-5SK51011-BL-ONE" and "M-5SK51011-BL-ONE"
  -- are the same physical product and must not land in separate rows.
  sku_key           text
    generated always as (
      upper(regexp_replace(coalesce(sku, ''), '[^a-zA-Z0-9]+', '', 'g'))
    ) stored,

  -- Options kept raw and separate. Normalising on write would destroy the
  -- evidence the hygiene report is built from — the whole point is to show
  -- the client exactly which spellings they typed.
  option1           text,
  option2           text,
  option3           text,

  price             numeric(12, 2) not null default 0,
  available         integer not null default 0,

  inventory_management text,            -- 'shopify' when tracked
  inventory_policy     text,            -- deny | continue

  variant_updated_at timestamptz,
  synced_at          timestamptz not null default now()
);

create index if not exists shopify_inv_sku_idx     on shopify_inventory (sku_key);
create index if not exists shopify_inv_product_idx on shopify_inventory (product_id);
create index if not exists shopify_inv_low_idx
  on shopify_inventory (available) where product_status = 'active';

alter table shopify_inventory enable row level security;

drop policy if exists shopify_inventory_read on public.shopify_inventory;
create policy shopify_inventory_read on public.shopify_inventory
  for select to authenticated using (true);
revoke select on public.shopify_inventory from anon;
grant  select on public.shopify_inventory to authenticated;

-- ── Sales velocity ───────────────────────────────────────────────────────
--
-- Deliberately counts Faire mirrors, unlike every revenue view in 0012.
-- Those views exclude mirrors to avoid double-counting the business; this
-- one must include them because a unit shipped through Faire leaves the
-- shelf exactly like a unit sold direct. Reorder demand is physical.
--
-- The window is 60 days because that is all Shopify returns without
-- read_all_orders — long enough for a rate, too short for seasonality.

drop view if exists v_inventory_velocity cascade;
create view v_inventory_velocity with (security_invoker = on) as
select
  li.variant_id,
  sum(li.quantity)                                   as units_60d,
  round(sum(li.quantity)::numeric / 60, 3)           as units_per_day,
  max(o.placed_at)                                   as last_sold_at
from shopify_line_items li
join shopify_orders o on o.id = li.order_id
where li.variant_id is not null
  and o.cancelled_at is null
  and o.test = false
  and coalesce(o.source_name, '') <> 'shopify_draft_order'
  and o.placed_at >= now() - interval '60 days'
group by li.variant_id;

-- ── Reorder alerts ───────────────────────────────────────────────────────
--
-- Severity is ordered by what a buyer should act on first, which is not the
-- same as ordering by how empty the shelf is. A zero that still sells is
-- urgent; a zero that has not sold in two months is discontinued stock and
-- belongs at the bottom of the list, not the top.
--
-- Archived and draft products are excluded — 1,215 of the 3,571 products are
-- archived, and alerting on them would bury the 171 that matter. Untracked
-- variants (inventory_management is null) are excluded too: their quantity
-- is always 0 and would read as a false stockout.

drop view if exists v_inventory_alerts cascade;
create view v_inventory_alerts with (security_invoker = on) as
with base as (
  select
    i.variant_id,
    i.product_id,
    i.product_title,
    i.variant_title,
    i.sku,
    i.sku_key,
    i.vendor,
    i.price,
    i.available,
    i.inventory_policy,
    coalesce(v.units_60d, 0)     as units_60d,
    coalesce(v.units_per_day, 0) as units_per_day,
    v.last_sold_at,
    case
      when coalesce(v.units_per_day, 0) > 0
        then round(i.available / v.units_per_day, 1)
    end as cover_days
  from shopify_inventory i
  left join v_inventory_velocity v on v.variant_id = i.variant_id
  where i.product_status = 'active'
    and i.inventory_management = 'shopify'
),
graded as (
  select
    b.*,
    case
      when b.available < 0                                then 'Oversold'
      when b.available = 0 and b.units_60d > 0            then 'Out - still selling'
      when b.cover_days is not null and b.cover_days < 14 then 'Critical'
      when b.available > 0 and b.available <= 5           then 'Low'
      when b.cover_days is not null and b.cover_days < 30 then 'Watch'
      when b.available = 0                                then 'Out - no recent sales'
    end as severity
  from base b
)
select
  variant_id, product_id, product_title, variant_title, sku, sku_key,
  vendor, price, available, units_60d, units_per_day, cover_days,
  last_sold_at, severity,
  case severity
    when 'Oversold'              then 1
    when 'Out - still selling'   then 2
    when 'Critical'              then 3
    when 'Low'                   then 4
    when 'Watch'                 then 5
    when 'Out - no recent sales' then 6
  end as rank
from graded
where severity is not null
order by rank, units_60d desc, available;

-- ── Catalogue hygiene: one thing typed several ways ──────────────────────
--
-- Groups every user-typed value by a case- and punctuation-insensitive key
-- and reports the keys that have more than one spelling. The raw spellings
-- are returned as an array so the page can show the client exactly what to
-- fix — "Pink vs PINK" is actionable, "you have inconsistent data" is not.
--
-- Scoped to active products. Rewriting an archived product's colour is busy
-- work, and including them would triple the list.

drop view if exists v_naming_issues cascade;
create view v_naming_issues with (security_invoker = on) as
with vals as (
  select 'Product name' as scope, product_title as raw, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(product_title), '') is not null
  union all
  select 'Option value', option1, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option1), '') is not null
  union all
  select 'Option value', option2, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option2), '') is not null
  union all
  select 'Option value', option3, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option3), '') is not null
  union all
  select 'Vendor', vendor, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(vendor), '') is not null
  union all
  select 'SKU', sku, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(sku), '') is not null
),
keyed as (
  select
    scope,
    raw,
    btrim(regexp_replace(upper(raw), '[^A-Z0-9]+', ' ', 'g')) as norm_key,
    variant_id
  from vals
)
select
  scope,
  norm_key,
  count(distinct raw)        as spellings,
  array_agg(distinct raw)    as variants_seen,
  count(distinct variant_id) as affected_variants
from keyed
where norm_key <> ''
group by scope, norm_key
having count(distinct raw) > 1
order by count(distinct variant_id) desc, count(distinct raw) desc, norm_key;

-- ── Catalogue hygiene: a SKU that is not unique ──────────────────────────
--
-- Distinct from the spelling report above. There the same value is typed
-- differently; here genuinely different variants share one SKU. For a
-- single store this is merely confusing. For the two-store rollup it is
-- disqualifying — the shared-SKU join has nothing unique to join on.

drop view if exists v_duplicate_skus cascade;
create view v_duplicate_skus with (security_invoker = on) as
select
  sku_key,
  count(*)                          as variants,
  sum(available)                    as units,
  array_agg(distinct sku)           as spellings,
  array_agg(distinct product_title) as products
from shopify_inventory
where product_status = 'active'
  and nullif(btrim(sku), '') is not null
group by sku_key
having count(*) > 1
order by count(*) desc, sum(available) desc;

grant  select on v_inventory_velocity, v_inventory_alerts,
                 v_naming_issues, v_duplicate_skus to authenticated;
revoke select on v_inventory_velocity, v_inventory_alerts,
                 v_naming_issues, v_duplicate_skus from anon;
