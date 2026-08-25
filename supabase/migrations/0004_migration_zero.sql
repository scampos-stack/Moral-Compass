-- A month with no direct orders must read 0%, not blank.
--
-- `sum(...) filter (where ...)` returns NULL when no row matches, so a month
-- where every order came through the marketplace produced direct_revenue NULL
-- and therefore revenue_migration_pct NULL. The dashboard rendered that as
-- an em dash — indistinguishable from "no data yet".
--
-- For the primary KPI of the engagement those are opposite meanings: "we
-- migrated nobody this month" is a finding, "we don't know" is not. Observed
-- on 2026-07, which had 3416.25 of revenue and no Faire Direct orders at all.

-- DROP first: CREATE OR REPLACE cannot change a view column's name,
-- order or type (42P16). Dropping makes this safe to re-run.
drop view if exists v_migration_rate cascade;
create view v_migration_rate with (security_invoker = on) as
with monthly as (
  select
    date_trunc('month', placed_at)::date as month,
    coalesce(sum(amount) filter (where sales_channel <> 'faire_marketplace'), 0)
      as direct_revenue,
    coalesce(sum(amount), 0) as total_revenue,
    count(distinct retailer_id) filter (where sales_channel <> 'faire_marketplace')
      as direct_buyers,
    count(distinct retailer_id) as total_buyers,
    coalesce(sum(commission_paid), 0) as commission_paid
  from orders
  where state <> 'cancelled'
  group by 1
)
select
  month,
  total_revenue,
  direct_revenue,
  -- Still NULL when there is genuinely no revenue to divide: that month has
  -- no migration rate, as opposed to a rate of zero.
  case when total_revenue > 0
       then round(100.0 * direct_revenue / total_revenue, 2)
  end as revenue_migration_pct,
  total_buyers,
  direct_buyers,
  case when total_buyers > 0
       then round(100.0 * direct_buyers / total_buyers, 2)
  end as buyer_migration_pct,
  commission_paid,
  round(commission_paid, 2) as commission_recoverable
from monthly
order by month desc;

grant select on v_migration_rate to authenticated;
revoke select on v_migration_rate from anon;
