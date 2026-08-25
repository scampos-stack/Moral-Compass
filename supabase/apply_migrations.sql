-- ═══════════════════════════════════════════════════════════════════════
--  RUN THIS WHOLE FILE, ONCE, IN A FRESH SUPABASE SQL EDITOR TAB.
--  Clear the editor first (Ctrl+A, Delete), paste this, Run.
--  Migrations 0004-0014 plus the Faire campaign seed.
--  Safe to re-run; creates and replaces only, deletes no data.
-- ═══════════════════════════════════════════════════════════════════════



-- ═══════════ 0004_migration_zero ═══════════

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


-- ═══════════ 0005_campaign_stats ═══════════

-- Woodpecker campaign statistics.
--
-- Woodpecker reports lifetime cumulative totals per campaign, not per-day
-- activity: GET /campaign_list?id=X returns {prospects, sent, delivery,
-- opened, replied, bounced, ...} as running counts. Those cannot go into
-- outreach_daily without double counting on every sync, so they get their own
-- table holding the latest snapshot per campaign.
--
-- One row per campaign, overwritten each sync. History is not kept here: the
-- numbers only ever move forward, and the dashboard reports current standing.

-- Re-runnable throughout: an earlier attempt failed at the view and left the
-- table behind, so every statement here tolerates already existing.

create table if not exists woodpecker_campaigns (
  id            bigint primary key,          -- Woodpecker's own campaign id
  name          text not null,
  status        text,                        -- RUNNING | STOPPED | COMPLETED
  from_email    text,
  created_at    timestamptz,

  prospects     integer not null default 0,
  sent          integer not null default 0,
  delivered     integer not null default 0,
  opened        integer not null default 0,
  clicked       integer not null default 0,
  replied       integer not null default 0,
  bounced       integer not null default 0,
  invalid       integer not null default 0,
  optout        integer not null default 0,

  -- Woodpecker's own reply classification, which the sheet tracked by hand.
  interested    integer not null default 0,
  maybe_later   integer not null default 0,
  not_interested integer not null default 0,

  synced_at     timestamptz not null default now()
);

alter table woodpecker_campaigns enable row level security;

drop policy if exists woodpecker_campaigns_read on woodpecker_campaigns;
create policy woodpecker_campaigns_read on woodpecker_campaigns
  for select to authenticated using (true);

revoke select on woodpecker_campaigns from anon;
grant select on woodpecker_campaigns to authenticated;

-- ── The Performance Table ────────────────────────────────────────────────
--
-- Replaces v_channel_performance. One row per outreach source, matching the
-- shape of the tracking sheet, but every figure derived from a live API
-- rather than typed in.
--
-- Response % is replies / sent for every source without exception. The sheet
-- divided LinkedIn's replies by *accepted connections* while dividing every
-- other source by sends, which inflated LinkedIn from 1.43% to 6.49% and made
-- it look like the best-converting channel.

-- DROP, not CREATE OR REPLACE. The 0001 version returned `sent` as numeric
-- (sum over a bigint union); this one returns bigint, and Postgres refuses to
-- change a view column's type in place:
--   42P16: cannot change data type of view column "sent"
drop view if exists v_channel_performance cascade;

create view v_channel_performance with (security_invoker = on) as
with sources as (
  -- Woodpecker: cumulative campaign counters.
  select
    'woodpecker_email'::channel as channel,
    coalesce(sum(sent), 0)      as sent,
    coalesce(sum(replied), 0)   as replies,
    coalesce(sum(opened), 0)    as opened,
    coalesce(sum(interested), 0) as interested
  from woodpecker_campaigns

  union all

  -- LinkedIn: hand-entered daily rows. Connection requests plus InMails are
  -- both outbound touches; `opened` maps to accepted connections, the nearest
  -- equivalent of an open.
  select
    'linkedin'::channel,
    coalesce(sum(connections_sent + inmails), 0),
    coalesce(sum(replies_total), 0),
    coalesce(sum(connections_accepted), 0),
    coalesce(sum(replies_positive), 0)
  from linkedin_daily
)
select
  s.channel,
  s.sent,
  s.replies,
  s.opened,
  s.interested,
  -- NULL, not zero, when nothing was sent: no rate exists to report.
  case when s.sent > 0
       then round(100.0 * s.replies / s.sent, 2)
  end as reply_rate_pct,
  coalesce(a.closed, 0)                  as closed,
  coalesce(a.revenue, 0)::numeric(12, 2) as revenue
from sources s
left join (
  select oa.channel, count(*) as closed, sum(o.amount) as revenue
  from order_attributions oa
  join orders o on o.id = oa.order_id
  where o.state <> 'cancelled'
  group by oa.channel
) a on a.channel = s.channel;

grant select on v_channel_performance to authenticated;
revoke select on v_channel_performance from anon;


-- ═══════════ 0006_atw_attribution ═══════════

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

-- DROP first: CREATE OR REPLACE cannot change a view column's name,
-- order or type (42P16). Dropping makes this safe to re-run.
drop view if exists v_atw_revenue cascade;
create view v_atw_revenue with (security_invoker = on) as
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


-- ═══════════ 0007_faire_campaigns_manual ═══════════

-- Faire marketing campaigns, entered by hand.
--
-- These are the email campaigns run inside Faire (Faire → Marketing →
-- Campaigns). Faire's external API exposes no marketing endpoint at all —
-- /campaigns, /marketing/campaigns, /email-campaigns and /promotions all 404,
-- on both v1 and v2 — so unlike orders there is nothing to sync. The numbers
-- have to be copied from the Faire UI, exactly as the tracking sheet did.
--
-- All of this work is A-Teamwork's, so every row counts toward ATW effort.
-- Columns mirror the Faire campaigns screen one-for-one, so transcription is
-- a straight read-across with nothing to reinterpret.

create table if not exists faire_campaigns_manual (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sent_on       date not null,
  status        text,                    -- Complete | Scheduled | Draft
  recipients    text,                    -- Faire's audience description

  delivered     integer not null default 0 check (delivered >= 0),
  -- Faire shows "2,976 / 3,413": delivered over attempted.
  attempted     integer not null default 0 check (attempted >= 0),

  -- Faire reports these as percentages, not counts, so they are stored as
  -- given rather than back-computed into counts we never actually saw.
  open_rate_pct  numeric(5, 2) check (open_rate_pct between 0 and 100),
  click_rate_pct numeric(5, 2) check (click_rate_pct between 0 and 100),

  orders_from_opens   integer not null default 0 check (orders_from_opens >= 0),
  orders_from_clicks  integer not null default 0 check (orders_from_clicks >= 0),
  volume_from_opens   numeric(12, 2) not null default 0 check (volume_from_opens >= 0),
  volume_from_clicks  numeric(12, 2) not null default 0 check (volume_from_clicks >= 0),

  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Faire allows two sends of the same name on one day (an "all contacts"
  -- blast and a segmented one), so name alone is not unique — but the same
  -- name, day AND audience is a duplicate entry.
  unique nulls not distinct (name, sent_on, recipients)
);

create index if not exists faire_campaigns_manual_sent_idx
  on faire_campaigns_manual (sent_on desc);

-- Faire attributes revenue to opens and to clicks separately; an order can
-- appear under both. Summing them would double count, so the total is stored
-- derived and the components stay visible.
alter table faire_campaigns_manual
  drop column if exists total_orders;
alter table faire_campaigns_manual
  add column total_orders integer
    generated always as (orders_from_opens + orders_from_clicks) stored;

alter table faire_campaigns_manual enable row level security;

drop policy if exists faire_campaigns_manual_read on faire_campaigns_manual;
create policy faire_campaigns_manual_read on faire_campaigns_manual
  for select to authenticated using (true);

revoke select on faire_campaigns_manual from anon;
grant select on faire_campaigns_manual to authenticated;

-- Rolled up for the Performance Table's "Faire campaigns" row.
create or replace view v_faire_manual_totals with (security_invoker = on) as
select
  count(*)                                as campaigns,
  coalesce(sum(delivered), 0)             as delivered,
  coalesce(sum(orders_from_opens), 0)     as orders_from_opens,
  coalesce(sum(orders_from_clicks), 0)    as orders_from_clicks,
  coalesce(sum(volume_from_opens), 0)::numeric(12, 2)  as volume_from_opens,
  coalesce(sum(volume_from_clicks), 0)::numeric(12, 2) as volume_from_clicks,
  coalesce(sum(volume_from_opens + volume_from_clicks), 0)::numeric(12, 2)
                                          as total_volume
from faire_campaigns_manual;

grant select on v_faire_manual_totals to authenticated;
revoke select on v_faire_manual_totals from anon;


-- ═══════════ 0008_gohighlevel ═══════════

-- GoHighLevel: pipelines, opportunities, social posts.
--
-- Location GVBMFLmQCcxOfaxtJXHm ("Frém", shopfrem.com). Verified live:
-- 946 opportunities across 5 pipelines, and a working social-posting feed.
--
-- This matters beyond CRM hygiene: LinkedIn deals are closed into the
-- "Chain Store Pipeline", so GHL — not LinkedIn — is where LinkedIn revenue
-- actually lives. Without this table the LinkedIn row can show effort but
-- never money.

create table if not exists ghl_pipelines (
  id         text primary key,
  name       text not null,
  stages     jsonb not null default '[]',
  synced_at  timestamptz not null default now()
);

create table if not exists ghl_opportunities (
  id              text primary key,
  name            text,
  pipeline_id     text references ghl_pipelines (id) on delete cascade,
  stage_id        text,
  stage_name      text,
  -- 'open' | 'won' | 'lost' | 'abandoned'
  status          text,
  monetary_value  numeric(12, 2) not null default 0,
  source          text,
  contact_name    text,
  contact_email   text,
  contact_company text,
  created_at      timestamptz,
  updated_at      timestamptz,
  last_status_change_at timestamptz,
  synced_at       timestamptz not null default now()
);

create index if not exists ghl_opps_pipeline_idx on ghl_opportunities (pipeline_id, status);
create index if not exists ghl_opps_created_idx  on ghl_opportunities (created_at desc);

create table if not exists ghl_social_posts (
  id           text primary key,
  platform     text,
  status       text,
  summary      text,
  account_id   text,
  posted_at    timestamptz,
  created_at   timestamptz,
  synced_at    timestamptz not null default now()
);

create index if not exists ghl_social_posted_idx on ghl_social_posts (posted_at desc);

alter table ghl_pipelines      enable row level security;
alter table ghl_opportunities  enable row level security;
alter table ghl_social_posts   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ghl_pipelines','ghl_opportunities','ghl_social_posts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t
    );
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ── Pipeline overview ────────────────────────────────────────────────────
--
-- Open value is pipeline, not revenue. Won value is money. Keeping them in
-- separate columns stops a healthy-looking pipeline being read as earnings.

create or replace view v_ghl_pipeline_summary with (security_invoker = on) as
select
  p.id   as pipeline_id,
  p.name as pipeline,
  count(o.id)                                                as opportunities,
  count(o.id) filter (where o.status = 'open')               as open_count,
  count(o.id) filter (where o.status = 'won')                as won_count,
  count(o.id) filter (where o.status = 'lost')               as lost_count,
  coalesce(sum(o.monetary_value), 0)::numeric(12, 2)         as total_value,
  coalesce(sum(o.monetary_value) filter (where o.status = 'open'), 0)::numeric(12, 2)
                                                             as open_value,
  coalesce(sum(o.monetary_value) filter (where o.status = 'won'), 0)::numeric(12, 2)
                                                             as won_value,
  -- Win rate over decided opportunities only. Counting still-open deals as
  -- losses would understate it early in a pipeline's life.
  case when count(o.id) filter (where o.status in ('won','lost')) > 0
       then round(100.0 * count(o.id) filter (where o.status = 'won')
                  / count(o.id) filter (where o.status in ('won','lost')), 2)
  end as win_rate_pct
from ghl_pipelines p
left join ghl_opportunities o on o.pipeline_id = p.id
group by p.id, p.name
order by total_value desc;

-- Stage-by-stage funnel, for spotting where deals stall.
create or replace view v_ghl_stage_funnel with (security_invoker = on) as
select
  p.name  as pipeline,
  o.stage_name as stage,
  count(*)                                            as opportunities,
  coalesce(sum(o.monetary_value), 0)::numeric(12, 2)  as value
from ghl_opportunities o
join ghl_pipelines p on p.id = o.pipeline_id
where o.status = 'open'
group by p.name, o.stage_name
order by p.name, value desc;

grant select on v_ghl_pipeline_summary, v_ghl_stage_funnel to authenticated;
revoke select on v_ghl_pipeline_summary, v_ghl_stage_funnel from anon;


-- ═══════════ 0009_rename_promotions ═══════════

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


-- ═══════════ 0010_rep_breakdown ═══════════

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

drop view if exists v_rep_revenue cascade;
create view v_rep_revenue with (security_invoker = on) as
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
-- DROP, not CREATE OR REPLACE. This adds other_rep_orders ahead of
-- untagged_orders, and Postgres treats that as renaming a view column:
--   42P16: cannot change name of view column
drop view if exists v_atw_revenue cascade;
create view v_atw_revenue with (security_invoker = on) as
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


-- ═══════════ 0011_campaign_creative ═══════════

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


-- ═══════════ 0012_shopify ═══════════

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


-- ═══════════ 0013_shopify_detail ═══════════

-- Shopify line items, collections, and campaign-link attribution.
--
-- Three things this makes answerable that the order table alone cannot:
--   what sold (line items), what category it belongs to (collections), and
--   which campaign link brought the buyer (UTM parameters).
--
-- On UTMs: checked the live store first. Across the 250 most recent orders,
-- zero carry a query string on landing_site and zero carry utm_ parameters.
-- Both genuine direct orders landed on "/" with no referrer and no discount
-- code. The columns below capture UTMs correctly the moment a tagged link is
-- used — but today there is nothing to attribute, and that absence is itself
-- the finding: campaign links are not arriving at Shopify with tracking.

alter table shopify_orders
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text;

create index if not exists shopify_orders_utm_idx
  on shopify_orders (utm_campaign) where utm_campaign is not null;

-- ── Line items ───────────────────────────────────────────────────────────

create table if not exists shopify_line_items (
  id           bigint primary key,
  order_id     bigint not null references shopify_orders (id) on delete cascade,
  product_id   bigint,
  variant_id   bigint,
  title        text,
  variant_title text,
  sku          text,
  vendor       text,
  quantity     integer not null default 0,
  price        numeric(12, 2) not null default 0,
  -- Line revenue, so per-collection totals never re-derive it inconsistently.
  line_total   numeric(12, 2)
    generated always as (price * quantity) stored,
  synced_at    timestamptz not null default now()
);

create index if not exists shopify_li_order_idx   on shopify_line_items (order_id);
create index if not exists shopify_li_product_idx on shopify_line_items (product_id);

-- ── Collections ──────────────────────────────────────────────────────────

create table if not exists shopify_collections (
  id          bigint primary key,
  title       text not null,
  kind        text,               -- custom | smart
  products    integer not null default 0,
  synced_at   timestamptz not null default now()
);

-- A product can sit in several collections, so revenue attributed by
-- collection intentionally does not sum to total revenue.
create table if not exists shopify_product_collections (
  product_id    bigint not null,
  collection_id bigint not null references shopify_collections (id) on delete cascade,
  primary key (product_id, collection_id)
);

create index if not exists shopify_pc_collection_idx
  on shopify_product_collections (collection_id);

alter table shopify_line_items          enable row level security;
alter table shopify_collections         enable row level security;
alter table shopify_product_collections enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'shopify_line_items','shopify_collections','shopify_product_collections'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ── Sales by collection ──────────────────────────────────────────────────
--
-- Deliberately spans ALL non-cancelled orders, Faire mirrors included. The
-- question "what sells" is about product, not channel — restricting this to
-- the two direct orders would make it useless. Channel splits live elsewhere.

create or replace view v_collection_sales with (security_invoker = on) as
select
  c.id                                    as collection_id,
  c.title                                 as collection,
  c.kind,
  count(distinct li.order_id)             as orders,
  sum(li.quantity)                        as units,
  sum(li.line_total)::numeric(12, 2)      as revenue,
  count(distinct li.order_id) filter (where o.is_direct_sale) as direct_orders,
  coalesce(sum(li.line_total) filter (where o.is_direct_sale), 0)::numeric(12, 2)
                                          as direct_revenue
from shopify_collections c
join shopify_product_collections pc on pc.collection_id = c.id
join shopify_line_items li on li.product_id = pc.product_id
join shopify_orders o on o.id = li.order_id
where o.cancelled_at is null
  and o.test = false
  and coalesce(o.source_name, '') <> 'shopify_draft_order'
group by c.id, c.title, c.kind
having sum(li.line_total) > 0
order by revenue desc;

-- Products without the collection join, for anything uncategorised.
create or replace view v_product_sales with (security_invoker = on) as
select
  li.product_id,
  max(li.title)                      as title,
  count(distinct li.order_id)        as orders,
  sum(li.quantity)                   as units,
  sum(li.line_total)::numeric(12, 2) as revenue
from shopify_line_items li
join shopify_orders o on o.id = li.order_id
where o.cancelled_at is null
  and o.test = false
  and coalesce(o.source_name, '') <> 'shopify_draft_order'
group by li.product_id
order by revenue desc;

-- ── Campaign links ───────────────────────────────────────────────────────

create or replace view v_utm_performance with (security_invoker = on) as
select
  coalesce(utm_source, '(none)')   as utm_source,
  coalesce(utm_medium, '(none)')   as utm_medium,
  coalesce(utm_campaign, '(none)') as utm_campaign,
  count(*)                         as orders,
  sum(total_price)::numeric(12, 2) as revenue,
  min(placed_at)::date             as first_order,
  max(placed_at)::date             as last_order
from shopify_orders
where is_direct_sale
group by 1, 2, 3
order by revenue desc;

grant select on v_collection_sales, v_product_sales, v_utm_performance
  to authenticated;
revoke select on v_collection_sales, v_product_sales, v_utm_performance
  from anon;


-- ═══════════ 0014_shopify_traffic ═══════════

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


-- ═══════════ seed: Faire campaigns since 4th July ═══════════

-- Faire email campaigns, transcribed from Faire → Marketing → Campaigns
-- (read 2026-08-25). Starts at "4th July 1st", the first A-Teamwork send.
--
-- Faire exposes no marketing API, so this is hand-transcribed. Re-running
-- updates rather than duplicating.
--
-- Two things to know about these numbers:
--
-- 1. They accrue. An earlier screenshot showed "Game Day … customer only" at
--    34% open / 1 order / $1,548; the later one shows 37% / 5 orders / $2,453
--    for the same send. Faire keeps crediting orders after the send date, so
--    a freshly-sent campaign always looks worse than it will end up. Re-enter
--    recent campaigns after a few weeks rather than treating day-one numbers
--    as final.
--
-- 2. Five sends between Jun 29 and Jul 17 report 0 delivered of 0 attempted:
--    "4th July 1st", "4th July Last 26", "Pearls, coins & coastal charm",
--    and both "Collection-led - Pre sale" emails. They are marked Complete in
--    Faire but have no delivery data at all. Loaded as zeros because that is
--    what Faire reports — but zero delivered is not the same as zero
--    performance, and these should be checked in Faire before anyone reads
--    them as failed campaigns.

insert into faire_campaigns_manual (
  name, sent_on, status, recipients, attempted, delivered,
  open_rate_pct, click_rate_pct,
  orders_from_opens, orders_from_clicks,
  volume_from_opens, volume_from_clicks, notes
) values
  ('4th July 1st', '2026-06-29', 'Complete',
   'EMAIL-OKAY-TOTAL, Not signed up, Not yet ordered, Last ordered 180+ days ago, Active cart, Faire Direct eligible, Contacted, On Faire, Ordered',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'First A-Teamwork campaign. Faire reports no delivery data — verify in Faire.'),

  ('4th July Last 26', '2026-07-03', 'Complete',
   'Not yet ordered, Not signed up, Not on Faire-coco active, Faire Direct eligible, Contacted, Active cart, Faire Direct leads, EMAIL-OKAY-TOTAL, Mark Roopchan, On Faire',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('Pearls, coins & coastal charm — now at wholesale.', '2026-07-08', 'Complete',
   'Last ordered 60+ days ago, On Faire, Ordered, Active cart, Last ordered 180+ days ago, Faire Direct Eligible 051426',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('EMAIL 1 — Collection-led - Pre sale', '2026-07-15', 'Complete',
   'Faire Direct leads, Last ordered 180+ days ago, Eligible to claim Faire Direct offer, EMAIL-OKAY-TOTAL, Last ordered 60+ days ago, Active cart, Ordered',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('EMAIL 2 — Collection-led - Pre sale', '2026-07-17', 'Complete',
   'Not review yet, Last ordered 180+ days ago, Ordered, 3k, Last ordered 60+ days ago, Faire Direct leads',
   0, 0, 0.00, 0.00, 0, 0, 0, 0,
   'Faire reports no delivery data — verify in Faire.'),

  ('Untitled campaign 338', '2026-07-17', 'Complete',
   'Uncontacted',
   81, 73, 23.00, 0.00, 0, 0, 0, 0,
   'Tiny test send, 81 recipients.'),

  ('EMAIL 1 - Faire Event 20th (IF SENT ON 19TH)', '2026-07-20', 'Complete',
   'On Faire, Active cart, Ordered, Last ordered 180+ days ago, Last ordered 60+ days ago, Faire Direct leads',
   28453, 22214, 34.00, 0.40, 15, 1, 4726, 576,
   'Best revenue per recipient of any send so far.'),

  ('Faire event email 2', '2026-07-23', 'Complete',
   'ALL- Marketable (valid email)',
   79552, 48026, 26.00, 0.37, 1, 0, 69, 0,
   'Broad blast: highest reach, lowest return.'),

  ('After Faire Event 28/7', '2026-07-29', 'Complete',
   'Faire Direct leads, Uncontacted, Last ordered 180+ days ago, Faire Direct Eligible 051426, Mark Roopchan, Unused credit, Top Spenders Above $4,000, Not signed up, On Faire, Contacted, ALL-Marketable (valid email), Ordered, Marketable Abandoned Cart, EMAIL-OKAY-TOTAL, New Customers (<60 Days), Reorder Ready Customers, 3k, Eligible to claim Faire Direct offer, Not review yet, Last ordered 60+ days ago, Active cart, Not yet ordered',
   85894, 71417, 29.00, 0.41, 8, 3, 3017, 720,
   null),

  ('Back To School email 1 (regular collection + 30% off))', '2026-08-04', 'Complete',
   'All contacts',
   85692, 66838, 29.00, 0.35, 8, 1, 2085, 705,
   null),

  ('Back To School email 1 (regular collection + 30% off)) (Copy 347)', '2026-08-05', 'Complete',
   'Last ordered 60+ days ago, New Customers (<60 Days), Active cart, Marketable has ordered, Faire Direct leads, 3k, Ordered, Not review yet, Top Spenders Above $4,000, Unused credit, Last ordered 180+ days ago',
   3481, 2968, 38.00, 0.57, 6, 0, 1733, 0,
   'Segmented copy of the all-contacts send the day before — 38% vs 29% open.'),

  ('Game Day & 30% Off Clearance (August 10–11) 1', '2026-08-11', 'Complete',
   'All contacts',
   85492, 66504, 29.00, 0.28, 7, 0, 2772, 0,
   null),

  ('Game Day & 30% Off Clearance (August 10–11) " customer only', '2026-08-13', 'Complete',
   'Last ordered 60+ days ago, Ordered, Last ordered 180+ days ago, Active cart',
   3413, 2976, 37.00, 0.07, 5, 0, 2453, 0,
   'Same offer, segmented: 2,976 delivered produced $2,453 against $2,772 from 66,504.'),

  ('Beat the Q4 rush: Last-minute BTS stocking & Autumn preview', '2026-08-18', 'Complete',
   'All contacts',
   85270, 70683, 30.00, 0.30, 6, 0, 1386, 0,
   null),

  ('xclusive re-order preview: Fall trends + last call for BTS 30% off', '2026-08-20', 'Complete',
   'Unused credit, Faire Direct leads, Last ordered 180+ days ago, Faire Direct Leads 80, Active cart, Last ordered 60+ days ago, Faire Direct Potential List, Ordered',
   3477, 3029, 38.00, 0.63, 3, 0, 839, 0,
   'Recent — orders will still accrue.')

on conflict (name, sent_on, recipients) do update set
  status             = excluded.status,
  attempted          = excluded.attempted,
  delivered          = excluded.delivered,
  open_rate_pct      = excluded.open_rate_pct,
  click_rate_pct     = excluded.click_rate_pct,
  orders_from_opens  = excluded.orders_from_opens,
  orders_from_clicks = excluded.orders_from_clicks,
  volume_from_opens  = excluded.volume_from_opens,
  volume_from_clicks = excluded.volume_from_clicks,
  notes              = excluded.notes,
  updated_at         = now();
