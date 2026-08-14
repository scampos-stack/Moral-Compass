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
