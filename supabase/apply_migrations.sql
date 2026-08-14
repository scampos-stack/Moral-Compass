-- ═══════════════════════════════════════════════════════════════════════
--  RUN THIS WHOLE FILE, ONCE, IN A FRESH SUPABASE SQL EDITOR TAB.
--
--  Clear the editor first — appending this after previous scripts is what
--  produced the earlier errors. Select all, delete, paste this, Run.
--
--  Combines migrations 0004 + 0005 + 0006 + 0007. Every statement tolerates
--  having been run before, so a partial earlier attempt is not a problem.
--  Creates and replaces objects only; deletes no data.
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

create or replace view v_migration_rate with (security_invoker = on) as
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
