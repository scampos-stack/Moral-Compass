-- Rename v_faire_campaigns -> v_faire_promotions.
--
-- Three distinct things were collapsed under one word:
--
--   Woodpecker campaigns      external cold email. Synced from Woodpecker.
--   Faire Campaigns           email campaigns run inside Faire
--                             (Marketing -> Campaigns). No API; hand-entered
--                             into faire_campaigns_manual.
--   Faire promotions          discount codes attached to an order
--                             (FaireMarket_Jan26, BlackFridaySale, WELCOME20).
--
-- The third is what the discount-code view actually reports, and it is NOT a
-- campaign. A promo code is redeemed at checkout by whoever happens to have
-- it; a campaign is a send to a chosen audience. Labelling redemption as
-- campaign performance would credit a marketing send for revenue it may have
-- had nothing to do with.

drop view if exists v_faire_campaigns cascade;

create or replace view v_faire_promotions with (security_invoker = on) as
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

grant select on v_faire_promotions to authenticated;
revoke select on v_faire_promotions from anon;
