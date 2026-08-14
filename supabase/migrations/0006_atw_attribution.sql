-- Faire's own attribution fields, which the sync was discarding.
--
-- Two things sit in the order payload that identify A-Teamwork's work:
--
--   sales_rep_name       — "ATW" on orders credited to A-Teamwork. Verified
--                          live: 124 orders / $33,843.76 across Jul–Aug 2026.
--   brand_discounts[]    — each carries a `code` such as FaireMarket_Jan26 or
--                          BlackFridaySale. This is how a Faire campaign gets
--                          measured instead of typed into a spreadsheet.
--
-- The tag is applied BY HAND, so it is a floor and not a total: an untagged
-- order may still be A-Teamwork's. Everything below is built to keep that
-- distinction visible — never present tagged revenue as the whole picture.

-- Re-runnable: a failed earlier attempt may have added the columns already.
alter table orders
  add column if not exists sales_rep_name text,
  -- All discount codes on the order. An order can carry more than one.
  add column if not exists discount_codes text[] not null default '{}';

create index if not exists orders_sales_rep_idx
  on orders (sales_rep_name) where sales_rep_name is not null;
create index if not exists orders_discount_codes_idx
  on orders using gin (discount_codes);

comment on column orders.sales_rep_name is
  'Faire sales rep credited on the order. "ATW" = A-Teamwork. Applied manually, so absence does not prove an order was not ours.';

-- ── Attributed revenue: tagged vs not ────────────────────────────────────

create or replace view v_atw_revenue with (security_invoker = on) as
select
  date_trunc('month', placed_at)::date as month,
  count(*) filter (where sales_rep_name = 'ATW')                    as atw_orders,
  coalesce(sum(amount) filter (where sales_rep_name = 'ATW'), 0)    as atw_revenue,
  coalesce(sum(commission_paid) filter (where sales_rep_name = 'ATW'), 0)
                                                                    as atw_commission,
  count(*) filter (where sales_rep_name is null)                    as untagged_orders,
  coalesce(sum(amount) filter (where sales_rep_name is null), 0)    as untagged_revenue,
  count(*)                                                          as total_orders,
  coalesce(sum(amount), 0)                                          as total_revenue,
  case when sum(amount) > 0
       then round(100.0 * coalesce(sum(amount) filter (where sales_rep_name = 'ATW'), 0)
                  / sum(amount), 2)
  end as atw_share_pct
from orders
where state <> 'cancelled'
group by 1
order by 1 desc;

-- ── Faire campaigns, by discount code ────────────────────────────────────
--
-- Replaces the hand-maintained "Faire Campaings" block in the sheet. Revenue
-- is the full order value on any order carrying the code — an order with two
-- codes counts toward both, so these rows intentionally do not sum to total
-- revenue. They answer "what did this campaign touch", not "what is our
-- revenue split".

create or replace view v_faire_campaigns with (security_invoker = on) as
select
  code,
  count(*)                             as orders,
  count(distinct retailer_id)          as buyers,
  sum(amount)::numeric(12, 2)          as revenue,
  count(*) filter (where sales_rep_name = 'ATW') as atw_orders,
  min(placed_at)::date                 as first_order,
  max(placed_at)::date                 as last_order
from orders, unnest(discount_codes) as code
where state <> 'cancelled'
group by code
order by revenue desc;

grant select on v_atw_revenue, v_faire_campaigns to authenticated;
revoke select on v_atw_revenue, v_faire_campaigns from anon;
