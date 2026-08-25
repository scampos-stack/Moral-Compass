-- Shopify traffic: who clicked, and from where.
--
-- Order data only ever shows sessions that CONVERTED. Clicks that browsed and
-- left are invisible there — which, when direct sales are two orders, means
-- almost everything is invisible. ShopifyQL exposes sessions, so the effort
-- side of the owned channel becomes measurable even before it sells.
--
-- Verified live (read_analytics, GraphQL shopifyqlQuery, 30 days):
--   referrer_source : direct 5,539 · search 191 · social 132 · unknown 29
--   utm_source      : email 352 · ig 80 · chatgpt.com 47 · bdr 5
--   referrer_name   : google 167 · facebook 67 · instagram 62 · linktr 9
--
-- Note what ShopifyQL will NOT do: `FROM sales ... GROUP BY utm_campaign`
-- returns "Column Not Found". Sessions can be grouped by campaign; sales
-- cannot. So clicks per link are knowable and revenue per link is not —
-- except through order-level landing_site, which is captured separately.

create table if not exists shopify_sessions (
  -- One row per dimension combination per snapshot window.
  id            uuid primary key default gen_random_uuid(),
  window_days   integer not null,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  referrer_name text,
  referrer_source text,
  landing_path  text,
  sessions      integer not null default 0,
  captured_at   timestamptz not null default now(),

  -- One row per combination per window. NULLS NOT DISTINCT so untagged
  -- traffic (all-NULL dimensions) collides on re-sync instead of duplicating.
  unique nulls not distinct
    (window_days, utm_source, utm_medium, utm_campaign, referrer_name,
     referrer_source, landing_path)
);

create index if not exists shopify_sessions_campaign_idx
  on shopify_sessions (utm_campaign) where utm_campaign is not null;

alter table shopify_sessions enable row level security;
drop policy if exists shopify_sessions_read on shopify_sessions;
create policy shopify_sessions_read on shopify_sessions
  for select to authenticated using (true);
revoke select on shopify_sessions from anon;
grant select on shopify_sessions to authenticated;

-- ── ATW contribution, direct and indirect ────────────────────────────────
--
-- A-Teamwork's work shows up two ways, and only one of them is tagged:
--
--   Direct   — Faire orders carrying sales_rep_name 'ATW'.
--   Indirect — revenue Faire credits to the email campaigns A-Teamwork
--              writes, designs and sends. Faire attributes these to the
--              campaign, never to a rep, so they are invisible to the tag.
--
-- These are two different attribution systems measuring overlapping ground:
-- an order can be both rep-tagged AND credited to a campaign. They are
-- therefore reported side by side and never summed into one headline — a
-- combined figure would double-count an unknown share.

create or replace view v_atw_contribution with (security_invoker = on) as
select
  (select coalesce(sum(amount), 0)
     from orders
    where sales_rep_name = 'ATW' and state <> 'cancelled')::numeric(12, 2)
    as direct_revenue,
  (select count(*)
     from orders
    where sales_rep_name = 'ATW' and state <> 'cancelled')
    as direct_orders,
  (select coalesce(sum(volume_from_opens + volume_from_clicks), 0)
     from faire_campaigns_manual)::numeric(12, 2)
    as campaign_revenue,
  (select coalesce(sum(orders_from_opens + orders_from_clicks), 0)
     from faire_campaigns_manual)
    as campaign_orders,
  (select count(*) from faire_campaigns_manual)
    as campaigns_run,
  (select coalesce(sum(delivered), 0) from faire_campaigns_manual)
    as emails_delivered;

grant select on v_atw_contribution to authenticated;
revoke select on v_atw_contribution from anon;
