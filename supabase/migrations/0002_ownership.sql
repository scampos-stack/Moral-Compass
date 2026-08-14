-- Buyer-relationship ownership, per the A-Teamwork proposal (March 2026).
--
-- 0001 answers "which outreach earned this revenue". This migration answers the
-- strategic question: "how much of the buyer base do we actually own?" Roughly
-- 77,000 relationships sit on Faire at 15% commission against ~4,000 owned on
-- Shopify. Moving orders leftward costs 15 cents on the dollar; the primary KPI
-- of the engagement is the rate at which they move rightward.

-- Ordered least-owned to most-owned so `order by` reads as migration progress.
create type sales_channel as enum (
  'faire_marketplace',  -- 15% commission, Faire owns the buyer
  'faire_direct',       -- 0% commission, transition bridge
  'shopify_direct'      -- 0% commission, fully owned
);

alter table orders
  add column sales_channel sales_channel not null default 'faire_marketplace',
  -- Rate at the time of the order. Stored, not looked up: Faire can change its
  -- take and historical margin must not silently rewrite itself.
  add column commission_rate numeric(5, 4) not null default 0.15
    check (commission_rate >= 0 and commission_rate <= 1);

create index on orders (sales_channel, placed_at desc);

alter table orders
  add column commission_paid numeric(12, 2)
    generated always as (round(amount * commission_rate, 2)) stored;

-- Faire orders synced from the Faire API are marketplace orders by definition;
-- only Shopify and Faire Direct arrive by other routes.
comment on column orders.sales_channel is
  'Which channel captured the transaction. Drives the migration KPI and the commission calculation.';

-- First order per retailer, so we can tell acquisition from migration.
create view v_retailer_journey with (security_invoker = on) as
select
  r.id as retailer_id,
  r.name,
  min(o.placed_at)                                as first_order_at,
  max(o.placed_at)                                as last_order_at,
  count(*)                                        as order_count,
  sum(o.amount)                                   as lifetime_revenue,
  sum(o.commission_paid)                          as lifetime_commission,
  -- The migration event we care about: they started on the marketplace and
  -- have since ordered through a channel Moral Compass owns.
  bool_or(o.sales_channel = 'faire_marketplace')  as ever_marketplace,
  bool_or(o.sales_channel <> 'faire_marketplace') as ever_direct,
  max(o.sales_channel)                            as furthest_channel
from retailers r
join orders o on o.retailer_id = r.id
where o.state <> 'cancelled'
group by r.id, r.name;

-- The proposal's primary KPI, by month. Two readings, because they diverge:
-- revenue share moves first (a few big direct orders), buyer share is the one
-- that actually reduces platform dependency.
create view v_migration_rate with (security_invoker = on) as
with monthly as (
  select
    date_trunc('month', placed_at)::date as month,
    sum(amount) filter (where sales_channel <> 'faire_marketplace') as direct_revenue,
    sum(amount)                                                     as total_revenue,
    count(distinct retailer_id) filter (where sales_channel <> 'faire_marketplace') as direct_buyers,
    count(distinct retailer_id)                                     as total_buyers,
    sum(commission_paid)                                            as commission_paid
  from orders
  where state <> 'cancelled'
  group by 1
)
select
  month,
  total_revenue,
  direct_revenue,
  case when total_revenue > 0
       then round(100.0 * direct_revenue / total_revenue, 2)
  end as revenue_migration_pct,
  total_buyers,
  direct_buyers,
  case when total_buyers > 0
       then round(100.0 * direct_buyers / total_buyers, 2)
  end as buyer_migration_pct,
  commission_paid,
  -- What the marketplace revenue would have cost nothing to earn, had it come
  -- through an owned channel. This is the number that justifies the project.
  round(commission_paid, 2) as commission_recoverable
from monthly
order by month desc;

-- Both views are declared `security_invoker = on` above. Postgres defaults
-- views to DEFINER rights, which would run them as the owner and quietly
-- bypass RLS on orders/retailers — invoker rights keep the caller's policies.
grant select on v_retailer_journey, v_migration_rate to authenticated;
