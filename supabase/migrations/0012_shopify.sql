-- Shopify orders — the owned channel the whole engagement is aiming at.
--
-- Kept in their own table rather than folded into `orders`, which is
-- Faire-shaped (faire_order_id NOT NULL, commission, sales_rep_name). The
-- comparison view below unions the two, so nothing is lost by keeping them
-- honest about their source.
--
-- Verified live against fremnyc.myshopify.com:
--   - Auth is OAuth client_credentials, NOT a permanent shpat_ token. The
--     grant returns a shpat_-shaped token that expires in 24h, so the sync
--     fetches one per run and never stores it.
--   - Orders are capped at ~60 days without read_all_orders. The store holds
--     11,545 orders; only 2026-06-26 onward is reachable. Anything older is
--     invisible until Shopify grants that scope.
--   - Unlike Faire, Shopify DOES expose buyer email — so a Shopify buyer can
--     be matched to an outreach prospect exactly, not by fuzzy name.

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

  -- Where the order came from. Shopify gives this per order, which is more
  -- than Faire ever does.
  source_name     text,
  landing_site    text,
  referring_site  text,
  discount_codes  text[] not null default '{}',
  tags            text,

  placed_at       timestamptz not null,
  updated_at      timestamptz,
  synced_at       timestamptz not null default now()
);

create index if not exists shopify_orders_placed_idx on shopify_orders (placed_at desc);
create index if not exists shopify_orders_email_idx  on shopify_orders (lower(email));

alter table shopify_orders enable row level security;
drop policy if exists shopify_orders_read on shopify_orders;
create policy shopify_orders_read on shopify_orders
  for select to authenticated using (true);
revoke select on shopify_orders from anon;
grant select on shopify_orders to authenticated;

-- ── Faire vs Shopify ─────────────────────────────────────────────────────
--
-- The comparison the proposal is built on: revenue on the platform that
-- charges 15% against revenue on the channel that charges nothing.
--
-- Draft orders and test orders are excluded — Shopify counts $0 draft orders
-- created inside the admin as real orders, and they would inflate the count
-- while adding nothing to revenue.

create or replace view v_channel_revenue with (security_invoker = on) as
select
  date_trunc('month', placed_at)::date as month,
  'faire'                              as platform,
  count(*)                             as orders,
  sum(amount)::numeric(12, 2)          as revenue,
  sum(commission_paid)::numeric(12, 2) as commission
from orders
where state <> 'cancelled'
group by 1

union all

select
  date_trunc('month', placed_at)::date,
  'shopify',
  count(*),
  sum(total_price)::numeric(12, 2),
  0::numeric(12, 2)   -- Shopify takes no marketplace commission
from shopify_orders
where cancelled_at is null
  and test = false
  and source_name is distinct from 'shopify_draft_order'
group by 1
order by 1 desc, 2;

-- Side-by-side per month, with the commission Shopify revenue avoided.
create or replace view v_faire_vs_shopify with (security_invoker = on) as
with f as (
  select date_trunc('month', placed_at)::date as month,
         count(*) as orders,
         sum(amount) as revenue,
         sum(commission_paid) as commission
  from orders where state <> 'cancelled' group by 1
),
s as (
  select date_trunc('month', placed_at)::date as month,
         count(*) as orders,
         sum(total_price) as revenue
  from shopify_orders
  where cancelled_at is null and test = false
    and source_name is distinct from 'shopify_draft_order'
  group by 1
)
select
  coalesce(f.month, s.month)                          as month,
  coalesce(f.orders, 0)                               as faire_orders,
  coalesce(f.revenue, 0)::numeric(12, 2)              as faire_revenue,
  coalesce(f.commission, 0)::numeric(12, 2)           as faire_commission,
  coalesce(s.orders, 0)                               as shopify_orders,
  coalesce(s.revenue, 0)::numeric(12, 2)              as shopify_revenue,
  -- What the same revenue would have cost on Faire at 15%. This is the
  -- number that makes the case for migrating buyers.
  round(coalesce(s.revenue, 0) * 0.15, 2)             as commission_avoided,
  case when coalesce(f.revenue, 0) + coalesce(s.revenue, 0) > 0
       then round(100.0 * coalesce(s.revenue, 0)
                  / (coalesce(f.revenue, 0) + coalesce(s.revenue, 0)), 2)
  end as shopify_share_pct
from f
full outer join s on s.month = f.month
order by 1 desc;

grant select on v_channel_revenue, v_faire_vs_shopify to authenticated;
revoke select on v_channel_revenue, v_faire_vs_shopify from anon;
