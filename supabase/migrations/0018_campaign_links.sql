-- Campaign links: a monthly series, so a live campaign has a shape and not
-- just a number.
--
-- 0014 stores sessions as a single 30-day aggregate. That answers "how much
-- traffic did this campaign get" and nothing else — you cannot see when a
-- campaign started, whether it is still running, or whether it died. For a
-- link someone is actively sending out, those are the questions.
--
-- Verified live against fremnyc.myshopify.com before writing this:
--
--   ShopifyQL groups sessions by month, utm_campaign, utm_source and
--   utm_medium in one query, 365 days back. That is the whole series.
--
--   It does NOT group SALES by utm_campaign — "Column Not Found:
--   utm_campaign". Order attribution therefore has to come from
--   shopify_orders.utm_*, which the order sync already fills from
--   landing_site. Right now exactly 0 of 625 orders carry one.
--
--   Live campaigns as of today, both August 2026 and both from Woodpecker
--   outreach: bdr/outreach/new-customers-2026 with 5 sessions, and
--   bdr/outreach/sarah-wiwiwiwi-2026 with 1, which looks like a test.
--
-- Against 57,223 untagged sessions over the same year. The tagging gap is
-- the finding, so the page reports it as a headline rather than burying it.

create table if not exists shopify_campaign_sessions (
  month        date not null,
  -- Empty string rather than null: these are primary key columns, and a null
  -- in a key silently stops the upsert from ever matching an existing row,
  -- so every sync would insert duplicates instead of updating.
  utm_source   text not null default '',
  utm_medium   text not null default '',
  utm_campaign text not null default '',
  sessions     integer not null default 0,
  captured_at  timestamptz not null default now(),
  primary key (month, utm_source, utm_medium, utm_campaign)
);

create index if not exists shopify_campaign_sessions_campaign_idx
  on shopify_campaign_sessions (utm_campaign)
  where utm_campaign <> '';

alter table shopify_campaign_sessions enable row level security;

drop policy if exists shopify_campaign_sessions_read
  on public.shopify_campaign_sessions;
create policy shopify_campaign_sessions_read
  on public.shopify_campaign_sessions
  for select to authenticated using (true);
revoke select on public.shopify_campaign_sessions from anon;
grant  select on public.shopify_campaign_sessions to authenticated;

-- ── One row per tagged campaign ──────────────────────────────────────────
--
-- `last_month` is what makes "active" answerable: a campaign whose last
-- session was four months ago is not running, however many clicks it once
-- had. Orders are joined from shopify_orders rather than from ShopifyQL,
-- which cannot group sales by campaign at all.

drop view if exists v_campaign_performance cascade;
create view v_campaign_performance with (security_invoker = on) as
with sess as (
  select
    utm_campaign,
    utm_source,
    utm_medium,
    sum(sessions)                                       as sessions,
    min(month)                                          as first_month,
    max(month)                                          as last_month,
    sum(sessions) filter (
      where month >= date_trunc('month', now() - interval '1 month')
    )                                                   as sessions_recent
  from shopify_campaign_sessions
  where utm_campaign <> ''
  group by 1, 2, 3
),
ord as (
  select
    utm_campaign,
    count(*)                          as orders,
    sum(total_price)::numeric(12, 2)  as revenue
  from shopify_orders
  where utm_campaign is not null
    and cancelled_at is null
    and test = false
  group by 1
)
select
  s.utm_campaign,
  s.utm_source,
  s.utm_medium,
  s.sessions,
  s.sessions_recent,
  s.first_month,
  s.last_month,
  coalesce(o.orders, 0)   as orders,
  coalesce(o.revenue, 0)  as revenue,
  -- Null rather than 0 when nothing has been clicked, so "no traffic yet"
  -- and "traffic that never converts" stay distinguishable.
  case when s.sessions > 0
       then round(100.0 * coalesce(o.orders, 0) / s.sessions, 2)
  end as conversion_pct
from sess s
left join ord o on o.utm_campaign = s.utm_campaign
order by s.last_month desc, s.sessions desc;

-- ── How much traffic is measurable at all ────────────────────────────────
--
-- The denominator for every campaign number on the page. A campaign with 5
-- sessions reads very differently beside 5,647 untagged ones in the same
-- month, and showing the campaign alone would flatter it.

drop view if exists v_traffic_tagging cascade;
create view v_traffic_tagging with (security_invoker = on) as
select
  month,
  sum(sessions) filter (where utm_campaign <> '')                 as tagged,
  sum(sessions) filter (where utm_campaign =  '' and utm_source <> '')
                                                                  as sourced_only,
  sum(sessions) filter (where utm_campaign =  '' and utm_source =  '')
                                                                  as untagged,
  sum(sessions)                                                   as total
from shopify_campaign_sessions
group by month
order by month desc;

grant  select on v_campaign_performance, v_traffic_tagging to authenticated;
revoke select on v_campaign_performance, v_traffic_tagging from anon;
