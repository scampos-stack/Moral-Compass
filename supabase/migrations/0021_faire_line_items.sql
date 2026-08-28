-- Faire line items: three and a half years of what actually sold, by SKU.
--
-- The reason this exists. SKU-level sales history in the dashboard began
-- 2026-06-26 — two months, Shopify only. Troy asked to "look at sales trends
-- from 2025" and agreed to test flagging hot items three to four weeks before
-- a season. Neither is possible from two months of data: you cannot know what
-- December does from June to August, and a seasonal alert built on that would
-- be invented numbers handed to the one person who would spot it immediately.
--
-- Verified live before writing this. The Faire order payload already carries
-- an `items` array — id, sku, quantity, price_cents, product_name,
-- variant_name — and the sync has been fetching and discarding it on every
-- run. Deep paging works and keeps returning them: page 40 came back with 50
-- of 50 orders carrying items, dated September–October 2024.
--
-- With 11,666 Faire orders reaching back to 2023-01-08, that is three
-- Christmases. And it is the right channel to measure: 615 of 620 Shopify
-- orders are Faire mirrors, so Faire is not a supplementary source here, it
-- is the sales history.
--
-- Cross-checked the join before committing to it: on 610 sampled Faire SKUs,
-- 85% match a Shopify variant exactly on the normalised key and 95% are
-- reachable allowing a prefix match. The remainder need a mapping pass and
-- are counted rather than silently dropped.

create table if not exists faire_line_items (
  -- Faire's own item id. Stable, so a re-sync updates rather than duplicates.
  id             text primary key,
  faire_order_id text not null,
  -- The order's placed date, denormalised onto the item. Every question here
  -- is "how much sold in month X", and carrying the date avoids joining
  -- 11,666 orders on each of those.
  ordered_at     timestamptz not null,

  sku            text,
  -- Same normalisation as shopify_inventory.sku_key, so the two join without
  -- either side having to remember how the other spells things.
  sku_key        text
    generated always as (
      upper(regexp_replace(coalesce(sku, ''), '[^a-zA-Z0-9]+', '', 'g'))
    ) stored,

  product_name   text,
  variant_name   text,
  quantity       integer not null default 0,
  price          numeric(12, 2) not null default 0,
  state          text,
  synced_at      timestamptz not null default now()
);

create index if not exists faire_li_sku_idx   on faire_line_items (sku_key);
create index if not exists faire_li_date_idx  on faire_line_items (ordered_at);
create index if not exists faire_li_order_idx on faire_line_items (faire_order_id);

alter table faire_line_items enable row level security;
drop policy if exists faire_line_items_read on public.faire_line_items;
create policy faire_line_items_read on public.faire_line_items
  for select to authenticated using (true);
revoke select on public.faire_line_items from anon;
grant  select on public.faire_line_items to authenticated;

-- ── Monthly units per SKU ────────────────────────────────────────────────

drop view if exists v_sku_monthly cascade;
create view v_sku_monthly with (security_invoker = on) as
select
  sku_key,
  date_trunc('month', ordered_at)::date as month,
  sum(quantity)                         as units,
  count(distinct faire_order_id)        as orders
from faire_line_items
where sku_key <> ''
group by 1, 2;

-- ── What each SKU does in each calendar month ────────────────────────────
--
-- The shape of a year, averaged over however many years we have for that
-- SKU. Averaged rather than summed because a SKU introduced in 2025 has one
-- December and one introduced in 2023 has three; summing would rank age
-- rather than demand.
--
-- The current, partial month is excluded. Including it would compare a
-- half-finished month against complete ones and make every SKU look like it
-- is collapsing.

drop view if exists v_sku_seasonality cascade;
create view v_sku_seasonality with (security_invoker = on) as
select
  sku_key,
  extract(month from ordered_at)::int              as cal_month,
  count(distinct extract(year from ordered_at))    as years_seen,
  sum(quantity)                                    as units_total,
  round(
    sum(quantity)::numeric
      / greatest(count(distinct extract(year from ordered_at)), 1),
    1
  )                                                as units_avg_year
from faire_line_items
where sku_key <> ''
  and ordered_at < date_trunc('month', now())
group by 1, 2;

-- ── The pre-season alert ─────────────────────────────────────────────────
--
-- Troy's ask, in one view: what is about to be in demand, and is there
-- enough of it on the shelf right now.
--
-- Looks at the next two calendar months rather than a rolling window,
-- because ordering happens in monthly rhythm and a factory lead time is
-- measured in weeks, not days. A style needs to be flagged while there is
-- still time to place the order — his Christmas example is precisely the
-- case where finding out in December is finding out too late.
--
-- Only SKUs with at least one prior year in those months appear. Without
-- that guard a SKU launched last week would be projected onto a season it
-- has never seen.

drop view if exists v_seasonal_risk cascade;
create view v_seasonal_risk with (security_invoker = on) as
with upcoming as (
  select
    s.sku_key,
    sum(s.units_avg_year) as expected_units,
    max(s.years_seen)     as years_seen
  from v_sku_seasonality s
  where s.cal_month in (
    extract(month from (now() + interval '1 month'))::int,
    extract(month from (now() + interval '2 months'))::int
  )
  group by s.sku_key
  having sum(s.units_avg_year) > 0
),
stock as (
  select
    sku_key,
    sum(available)                    as on_hand,
    count(*)                          as variants,
    min(product_title)                as product_title
  from shopify_inventory
  where product_status = 'active'
    and inventory_management = 'shopify'
    and sku_key <> ''
  group by sku_key
)
select
  u.sku_key,
  st.product_title,
  st.on_hand,
  st.variants,
  u.expected_units,
  u.years_seen,
  (u.expected_units - st.on_hand)::numeric(12, 1) as shortfall,
  case
    when st.on_hand = 0                        then 'Nothing on hand'
    when st.on_hand < u.expected_units * 0.5   then 'Under half'
    else                                            'Short'
  end as severity
from upcoming u
join stock st on st.sku_key = u.sku_key
where st.on_hand < u.expected_units
order by (u.expected_units - st.on_hand) desc;

-- ── Hiding a single variant ──────────────────────────────────────────────
--
-- Troy's problem, verbatim: two of four colours in a style are out of stock
-- and he has decided to leave them that way, but the other two still sell.
-- Deactivating the product in Shopify would silence the two that are
-- working, so Shopify cannot express this. The dashboard has to.
--
-- Two kinds, because "discontinued" is the wrong word for his actual case.
-- A summer colour empty in August is not discontinued; it is out of season,
-- and it needs to come back on its own before next summer. A hide with no
-- end date would bury it permanently and nobody would notice it missing in
-- May — the same failure as the noise it was meant to remove, only later.

create table if not exists variant_hidden (
  variant_id bigint primary key,
  kind       text not null check (kind in ('discontinued', 'seasonal')),
  -- Required for a seasonal hide, meaningless for a discontinuation.
  until      date,
  reason     text,
  actor      text not null,
  created_at timestamptz not null default now(),
  constraint variant_hidden_until_required
    check (kind <> 'seasonal' or until is not null)
);

create index if not exists variant_hidden_until_idx on variant_hidden (until);

alter table variant_hidden enable row level security;
drop policy if exists variant_hidden_read on public.variant_hidden;
create policy variant_hidden_read on public.variant_hidden
  for select to authenticated using (true);
revoke select on public.variant_hidden from anon;
grant  select on public.variant_hidden to authenticated;

-- Expired seasonal hides simply stop matching, so a variant reappears
-- without anyone remembering to unhide it.
drop view if exists v_variant_hidden_active cascade;
create view v_variant_hidden_active with (security_invoker = on) as
select variant_id, kind, until, reason, actor, created_at
from variant_hidden
where kind = 'discontinued'
   or until >= current_date;

grant  select on v_sku_monthly, v_sku_seasonality, v_seasonal_risk,
                 v_variant_hidden_active to authenticated;
revoke select on v_sku_monthly, v_sku_seasonality, v_seasonal_risk,
                 v_variant_hidden_active from anon;
