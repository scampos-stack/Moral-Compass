-- Record what each Faire campaign actually looked like.
--
-- The team has been testing text-only sends against visual ones. Without
-- recording which was which, the open and click rates sitting in this table
-- cannot answer the question the tests were run to answer.
--
-- Free text rather than an enum: the useful description of a creative is
-- rarely one of three fixed words, and an enum would force a real variant
-- into the wrong bucket or block the entry entirely.

alter table faire_campaigns_manual
  add column if not exists creative_type text;

comment on column faire_campaigns_manual.creative_type is
  'Creative treatment tested — e.g. text only, visual, mixed. Free text so an unanticipated variant is recordable.';

-- Rate comparison across creative treatments, weighted by delivery.
-- Averaging per-campaign percentages would let an 81-recipient send count
-- as much as an 85,000-recipient one.
create or replace view v_creative_performance with (security_invoker = on) as
select
  coalesce(nullif(trim(creative_type), ''), '(not recorded)') as creative_type,
  count(*)                                    as campaigns,
  sum(delivered)                              as delivered,
  sum(orders_from_opens + orders_from_clicks) as orders,
  sum(volume_from_opens + volume_from_clicks)::numeric(12, 2) as volume,
  -- Weighted by delivered, so big sends dominate as they should.
  case when sum(delivered) > 0
       then round(sum(open_rate_pct * delivered) / sum(delivered), 2)
  end as open_rate_pct,
  case when sum(delivered) > 0
       then round(sum(click_rate_pct * delivered) / sum(delivered), 2)
  end as click_rate_pct,
  -- Revenue per thousand delivered: the figure that decides whether a
  -- treatment is worth repeating.
  case when sum(delivered) > 0
       then round(
         1000 * sum(volume_from_opens + volume_from_clicks) / sum(delivered), 2)
  end as revenue_per_1k
from faire_campaigns_manual
where delivered > 0
group by 1
order by volume desc;

grant select on v_creative_performance to authenticated;
revoke select on v_creative_performance from anon;
