-- Break revenue out by sales rep, not just ATW-vs-rest.
--
-- Faire's "Sales representative" field holds more than one name:
--   ATW   scampos@a-teamwork.com   — A-Teamwork, the agency
--   Mark  mark@shopfrem.com        — in-house
--
-- The previous v_atw_revenue split ATW against everything-else, which quietly
-- folded Mark's in-house sales into "untagged" and made the untagged gap look
-- larger than it is. Three buckets are needed, not two: agency, in-house, and
-- genuinely unattributed.

create or replace view v_rep_revenue with (security_invoker = on) as
select
  date_trunc('month', placed_at)::date         as month,
  coalesce(sales_rep_name, '(untagged)')       as rep,
  count(*)                                     as orders,
  count(distinct retailer_id)                  as buyers,
  sum(amount)::numeric(12, 2)                  as revenue,
  sum(commission_paid)::numeric(12, 2)         as commission
from orders
where state <> 'cancelled'
group by 1, 2
order by 1 desc, revenue desc;

-- Monthly, one row per month, with each rep as its own column so the three
-- buckets can be read side by side.
create or replace view v_atw_revenue with (security_invoker = on) as
select
  date_trunc('month', placed_at)::date as month,

  count(*) filter (where sales_rep_name = 'ATW')                 as atw_orders,
  coalesce(sum(amount) filter (where sales_rep_name = 'ATW'), 0) as atw_revenue,
  coalesce(sum(commission_paid) filter (where sales_rep_name = 'ATW'), 0)
                                                                 as atw_commission,

  -- Any other named rep. Named rather than hardcoded to 'Mark', so a rep
  -- added in Faire tomorrow is counted instead of silently dropping into
  -- the untagged bucket.
  count(*) filter (where sales_rep_name is not null and sales_rep_name <> 'ATW')
                                                                 as other_rep_orders,
  coalesce(sum(amount) filter (where sales_rep_name is not null and sales_rep_name <> 'ATW'), 0)
                                                                 as other_rep_revenue,

  count(*) filter (where sales_rep_name is null)                 as untagged_orders,
  coalesce(sum(amount) filter (where sales_rep_name is null), 0) as untagged_revenue,

  count(*)                 as total_orders,
  coalesce(sum(amount), 0) as total_revenue,

  case when sum(amount) > 0
       then round(100.0 * coalesce(sum(amount) filter (where sales_rep_name = 'ATW'), 0)
                  / sum(amount), 2)
  end as atw_share_pct
from orders
where state <> 'cancelled'
group by 1
order by 1 desc;

grant select on v_rep_revenue, v_atw_revenue to authenticated;
revoke select on v_rep_revenue, v_atw_revenue from anon;
