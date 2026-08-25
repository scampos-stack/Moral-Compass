-- Shopify orders — the owned channel the whole engagement is aiming at.
--
-- Verified live against fremnyc.myshopify.com before writing any of this:
--
--   Auth is OAuth client_credentials, NOT a permanent shpat_. The grant
--   returns a shpat_-shaped token that expires in 24h, so the sync fetches
--   one per run and never stores it.
--
--   Orders are capped at ~60 days without read_all_orders. Reachable window
--   is 2026-06-26 onward — which happens to line up with when A-Teamwork
--   published the site, so the window covers the A-Teamwork era even though
--   it cannot cover the store's history.
--
--   Shopify DOES expose buyer email, which Faire never does. A Shopify buyer
--   can therefore be matched to an outreach prospect exactly rather than by
--   fuzzy company name.
--
-- THE CRITICAL ONE: Faire mirrors every marketplace order into Shopify,
-- tagged "Faire, Wholesale" with source_name "faire". Across the whole
-- reachable window: 617 orders, of which 612 are Faire mirrors ($159,235.94),
-- 3 are admin drafts, and exactly 2 are genuine direct sales ($362.85).
--
-- Counting Shopify naively would therefore double-count almost the entire
-- business and report the marketplace as the owned channel. Every view below
-- excludes the mirrors.

create table if not exists shopify_orders (
  id              bigint primary key,          -- Shopify's own order id
  order_number    text,
  name            text,                        -- the #1234 label
  email           text,
  customer_name   text,
  company         text,

  total_price     numeric(12, 2) not null default 0,
  subtotal_price  numeric(12, 2) not null default 0,
  total_discounts numeric(12, 2) not null default 0,
  currency        text not null default 'USD',

  financial_status    text,
  fulfillment_status  text,
  cancelled_at        timestamptz,
  test                boolean not null default false,

  source_name     text,
  landing_site    text,
  referring_site  text,
  discount_codes  text[] not null default '{}',
  tags            text,

  placed_at       timestamptz not null,
  updated_at      timestamptz,
  synced_at       timestamptz not null default now()
);

-- Marks orders Faire pushed into Shopify. Generated rather than computed at
-- query time so no view can forget the filter and silently double-count.
-- Matches on either signal: source_name is authoritative, but the tag catches
-- anything imported by a different route.
alter table shopify_orders
  add column if not exists is_faire_mirror boolean
    generated always as (
      lower(coalesce(source_name, '')) = 'faire'
      or coalesce(tags, '') ilike '%faire%'
    ) stored;

-- True direct sales: not a Faire mirror, not a draft, not a test, not cancelled.
alter table shopify_orders
  add column if not exists is_direct_sale boolean
    generated always as (
      not (
        lower(coalesce(source_name, '')) = 'faire'
        or coalesce(tags, '') ilike '%faire%'
      )
      and coalesce(source_name, '') <> 'shopify_draft_order'
      and test = false
      and cancelled_at is null
    ) stored;

create index if not exists shopify_orders_placed_idx on shopify_orders (placed_at desc);
create index if not exists shopify_orders_email_idx  on shopify_orders (lower(email));
create index if not exists shopify_orders_direct_idx on shopify_orders (is_direct_sale, placed_at desc);

alter table shopify_orders enable row level security;
drop policy if exists shopify_orders_read on shopify_orders;
create policy shopify_orders_read on shopify_orders
  for select to authenticated using (true);
revoke select on shopify_orders from anon;
grant select on shopify_orders to authenticated;

comment on column shopify_orders.is_faire_mirror is
  'Faire pushes marketplace orders into Shopify tagged "Faire, Wholesale". These are NOT direct sales and must never be counted as such.';

-- ── Faire vs Shopify ─────────────────────────────────────────────────────
--
-- The comparison the proposal is built on: revenue on the platform charging
-- 15% against revenue on the channel charging nothing.

drop view if exists v_faire_vs_shopify cascade;
create view v_faire_vs_shopify with (security_invoker = on) as
with f as (
  select date_trunc('month', placed_at)::date as month,
         count(*)             as orders,
         sum(amount)          as revenue,
         sum(commission_paid) as commission
  from orders
  where state <> 'cancelled'
  group by 1
),
s as (
  select date_trunc('month', placed_at)::date as month,
         count(*)          as orders,
         sum(total_price)  as revenue
  from shopify_orders
  where is_direct_sale     -- excludes Faire mirrors, drafts, tests, cancels
  group by 1
),
mirror as (
  -- Reported so the exclusion is visible rather than silent. If this column
  -- is large and direct is small, that IS the finding.
  select date_trunc('month', placed_at)::date as month,
         count(*)         as orders,
         sum(total_price) as revenue
  from shopify_orders
  where is_faire_mirror and cancelled_at is null and test = false
  group by 1
)
select
  coalesce(f.month, s.month, m.month)              as month,
  coalesce(f.orders, 0)                            as faire_orders,
  coalesce(f.revenue, 0)::numeric(12, 2)           as faire_revenue,
  coalesce(f.commission, 0)::numeric(12, 2)        as faire_commission,
  coalesce(s.orders, 0)                            as shopify_orders,
  coalesce(s.revenue, 0)::numeric(12, 2)           as shopify_revenue,
  coalesce(m.orders, 0)                            as mirrored_orders,
  coalesce(m.revenue, 0)::numeric(12, 2)           as mirrored_revenue,
  -- What direct revenue would have cost on Faire at 15%: the saving that
  -- argues for migrating buyers.
  round(coalesce(s.revenue, 0) * 0.15, 2)          as commission_avoided,
  case when coalesce(f.revenue, 0) + coalesce(s.revenue, 0) > 0
       then round(100.0 * coalesce(s.revenue, 0)
                  / (coalesce(f.revenue, 0) + coalesce(s.revenue, 0)), 2)
  end as shopify_share_pct
from f
full outer join s on s.month = f.month
full outer join mirror m on m.month = coalesce(f.month, s.month)
order by 1 desc;

-- Direct buyers, and whether they also buy on Faire. Shopify gives an email,
-- so this match is exact — not the fuzzy company-name matching Faire forces.
drop view if exists v_shopify_direct_buyers cascade;
create view v_shopify_direct_buyers with (security_invoker = on) as
select
  lower(email)                     as email,
  max(customer_name)               as customer_name,
  count(*)                         as orders,
  sum(total_price)::numeric(12, 2) as revenue,
  min(placed_at)::date             as first_order,
  max(placed_at)::date             as last_order
from shopify_orders
where is_direct_sale and email is not null
group by lower(email)
order by revenue desc;

grant select on v_faire_vs_shopify, v_shopify_direct_buyers to authenticated;
revoke select on v_faire_vs_shopify, v_shopify_direct_buyers from anon;
