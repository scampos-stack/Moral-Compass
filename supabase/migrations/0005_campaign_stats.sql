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
