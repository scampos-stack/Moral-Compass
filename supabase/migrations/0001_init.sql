-- Moral Compass / Frém — effort → revenue attribution
--
-- Effort arrives from three places: Woodpecker (cold email), Faire (marketplace
-- campaigns), and LinkedIn (hand-keyed, no API). Revenue arrives from Faire
-- orders. The join between them is `order_attributions`: an order is credited
-- to the most recent touch on that retailer inside the attribution window.

create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────────────────

create type channel as enum (
  'woodpecker_email',   -- automated cold email sequences
  'faire_campaign',     -- Faire's own marketplace messaging
  'manual_email',       -- hand-sent follow-ups
  'linkedin'            -- connections, follow-ups, InMail
);

create type touch_kind as enum (
  'email', 'follow_up', 'faire_message', 'connection_request', 'inmail'
);

create type reply_sentiment as enum ('positive', 'neutral', 'negative');

-- Normalised from Faire's raw states (NEW, PROCESSING, IN_TRANSIT, DELIVERED,
-- BACKORDERED, CANCELED, …). The verbatim value is kept in orders.raw_state so
-- a state we have not seen yet never silently becomes 'pending'.
create type order_state as enum (
  'pending', 'processing', 'in_transit', 'delivered', 'cancelled'
);

-- ── Dimensions ───────────────────────────────────────────────────────────

create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  channel     channel not null,
  name        text not null,
  external_id text,                 -- Woodpecker campaign id / Faire campaign id
  active      boolean not null default true,
  started_on  date,
  ended_on    date,
  created_at  timestamptz not null default now(),
  unique (channel, name)
);

-- Woodpecker sends from rotating domains; deliverability is tracked per domain.
create table sending_domains (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table retailers (
  id                uuid primary key default gen_random_uuid(),
  faire_retailer_id text unique,     -- null until we see them on Faire
  name              text not null,
  primary_email     text,
  country           text,
  created_at        timestamptz not null default now()
);

create index on retailers (lower(name));
create index on retailers (lower(primary_email));

create table prospects (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  linkedin_url text unique,
  company_name text,
  retailer_id  uuid references retailers (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- A prospect is only useful if we can reach them somehow.
  constraint prospect_has_a_handle check (email is not null or linkedin_url is not null)
);

create index on prospects (retailer_id);

-- ── Effort ───────────────────────────────────────────────────────────────

-- One row per individual outbound touch. This is what makes per-order
-- attribution possible; the daily rollups below cannot do it.
create table touches (
  id                uuid primary key default gen_random_uuid(),
  prospect_id       uuid not null references prospects (id) on delete cascade,
  channel           channel not null,
  kind              touch_kind not null,
  campaign_id       uuid references campaigns (id) on delete set null,
  sending_domain_id uuid references sending_domains (id) on delete set null,
  external_id       text,           -- source-system id, for idempotent syncs
  sent_at           timestamptz not null,
  opened_at         timestamptz,
  replied_at        timestamptz,
  bounced_at        timestamptz,
  sentiment         reply_sentiment,
  created_at        timestamptz not null default now(),
  unique (channel, external_id)
);

create index on touches (prospect_id, sent_at desc);
create index on touches (sent_at desc);
create index on touches (campaign_id, sent_at desc);

-- Daily rollups straight from the source APIs. Kept alongside `touches`
-- because Faire reports campaign totals only — it never exposes per-recipient
-- sends — so for that channel this table is the only record of effort.
create table outreach_daily (
  id                uuid primary key default gen_random_uuid(),
  activity_date     date not null,
  channel           channel not null,
  campaign_id       uuid references campaigns (id) on delete cascade,
  sending_domain_id uuid references sending_domains (id) on delete cascade,
  sent              integer not null default 0 check (sent >= 0),
  delivered         integer not null default 0 check (delivered >= 0),
  views             integer not null default 0 check (views >= 0),
  replies           integer not null default 0 check (replies >= 0),
  bounces           integer not null default 0 check (bounces >= 0),
  synced_at         timestamptz not null default now(),
  -- One row per day per campaign per domain. COALESCE so the nullable FKs
  -- still collide on re-sync instead of inserting duplicates.
  unique nulls not distinct (activity_date, channel, campaign_id, sending_domain_id)
);

create index on outreach_daily (activity_date desc, channel);

-- The LinkedIn tab, hand-keyed today. No LinkedIn API gives us this, so the
-- dashboard owns the form and this table replaces the spreadsheet.
create table linkedin_daily (
  activity_date        date primary key,
  connections_sent     integer not null default 0 check (connections_sent >= 0),
  connections_accepted integer not null default 0 check (connections_accepted >= 0),
  inmails              integer not null default 0 check (inmails >= 0),
  replies_positive     integer not null default 0 check (replies_positive >= 0),
  replies_neutral      integer not null default 0 check (replies_neutral >= 0),
  replies_negative     integer not null default 0 check (replies_negative >= 0),
  notes                text,
  entered_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- You cannot accept more connections than you sent that day.
  constraint accepted_within_sent check (connections_accepted <= connections_sent)
);

-- Derived so the dashboard never recomputes it and never divides by zero —
-- the spreadsheet's #DIV/0! on every no-send day is exactly this bug.
alter table linkedin_daily
  add column replies_total integer
    generated always as (replies_positive + replies_neutral + replies_negative) stored;

-- ── Revenue ──────────────────────────────────────────────────────────────

create table orders (
  id             uuid primary key default gen_random_uuid(),
  faire_order_id text not null unique,
  display_id     text,             -- the human-facing code, e.g. XNNZYET3TV
  retailer_id    uuid not null references retailers (id) on delete restrict,
  placed_at      timestamptz not null,
  amount         numeric(12, 2) not null check (amount >= 0),
  currency       text not null default 'USD',
  state          order_state not null default 'pending',
  raw_state      text,             -- Faire's verbatim state, unmapped
  is_confirmed   boolean not null default false,
  synced_at      timestamptz not null default now()
);

create index on orders (placed_at desc);
create index on orders (retailer_id, placed_at desc);

-- ── Attribution ──────────────────────────────────────────────────────────

-- One row per order at most: an order gets a single credited channel.
create table order_attributions (
  order_id          uuid primary key references orders (id) on delete cascade,
  touch_id          uuid references touches (id) on delete set null,
  channel           channel not null,
  hours_since_touch numeric(8, 2),
  -- 'last_touch' = matched to a real touch; 'manual' = a human decided.
  method            text not null default 'last_touch',
  computed_at       timestamptz not null default now()
);

create index on order_attributions (channel);

-- ── Sync bookkeeping ─────────────────────────────────────────────────────

create table sync_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,       -- 'faire' | 'woodpecker'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running',
  rows_upserted integer not null default 0,
  error         text
);

create index on sync_runs (source, started_at desc);

-- ── Attribution routine ──────────────────────────────────────────────────

-- Credits each unattributed order to the most recent touch on that retailer
-- within `window_hours`. Idempotent: safe to re-run, and re-runs pick up
-- touches that synced after the order did.
create or replace function attribute_orders(window_hours integer default 72)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  with candidate as (
    select distinct on (o.id)
      o.id  as order_id,
      t.id  as touch_id,
      t.channel,
      extract(epoch from (o.placed_at - t.sent_at)) / 3600.0 as hours_since
    from orders o
    join prospects p on p.retailer_id = o.retailer_id
    join touches   t on t.prospect_id = p.id
    where t.sent_at <= o.placed_at
      and t.sent_at >= o.placed_at - make_interval(hours => window_hours)
    order by o.id, t.sent_at desc
  )
  insert into order_attributions (order_id, touch_id, channel, hours_since_touch, method)
  select order_id, touch_id, channel, round(hours_since, 2), 'last_touch'
  from candidate
  on conflict (order_id) do update
    set touch_id          = excluded.touch_id,
        channel           = excluded.channel,
        hours_since_touch = excluded.hours_since_touch,
        computed_at       = now()
    -- Never clobber a human's call.
    where order_attributions.method <> 'manual';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ── Reporting views ──────────────────────────────────────────────────────

-- The spreadsheet's Performance Table, per channel.
-- security_invoker: without it Postgres runs views as the owner and bypasses
-- RLS on the base tables.
create view v_channel_performance with (security_invoker = on) as
with effort as (
  select channel,
         sum(sent)    as sent,
         sum(replies) as replies
  from outreach_daily
  group by channel
  union all
  -- Ungrouped aggregate: always yields one row, all-NULL when the table is
  -- empty. Coalesce so an empty LinkedIn tab reads as 0, not blank.
  select 'linkedin'::channel,
         coalesce(sum(connections_sent + inmails), 0),
         coalesce(sum(replies_total), 0)
  from linkedin_daily
),
effort_rolled as (
  select channel, sum(sent) as sent, sum(replies) as replies
  from effort
  group by channel
),
revenue as (
  select a.channel,
         count(*)         as closed,
         sum(o.amount)    as revenue
  from order_attributions a
  join orders o on o.id = a.order_id
  where o.state <> 'cancelled'
  group by a.channel
)
select
  e.channel,
  e.sent,
  e.replies,
  -- NULL rather than a divide-by-zero on days with no sends.
  case when e.sent > 0
       then round(100.0 * e.replies / e.sent, 2)
  end as reply_rate_pct,
  coalesce(r.closed, 0)       as closed,
  coalesce(r.revenue, 0)::numeric(12, 2) as revenue
from effort_rolled e
left join revenue r on r.channel = e.channel;

-- Daily effort across every channel, for the 7d/30d trend panels.
create view v_outreach_daily_all with (security_invoker = on) as
select activity_date, channel, sum(sent) as sent, sum(replies) as replies
from outreach_daily
group by activity_date, channel
union all
select activity_date,
       'linkedin'::channel,
       connections_sent + inmails,
       replies_total
from linkedin_daily;

-- ── Row-Level Security ───────────────────────────────────────────────────
--
-- Every table is readable by any signed-in user. Writes are service-role only
-- (which bypasses RLS entirely) except linkedin_daily, the one table humans
-- type into. No anon access anywhere.

alter table campaigns          enable row level security;
alter table sending_domains    enable row level security;
alter table retailers          enable row level security;
alter table prospects          enable row level security;
alter table touches            enable row level security;
alter table outreach_daily     enable row level security;
alter table linkedin_daily     enable row level security;
alter table orders             enable row level security;
alter table order_attributions enable row level security;
alter table sync_runs          enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'campaigns', 'sending_domains', 'retailers', 'prospects', 'touches',
    'outreach_daily', 'linkedin_daily', 'orders', 'order_attributions', 'sync_runs'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t
    );
  end loop;
end;
$$;

create policy linkedin_daily_write on linkedin_daily
  for all to authenticated using (true) with check (true);

-- ── Seed: what the spreadsheet already knows ─────────────────────────────

insert into sending_domains (domain, active) values
  ('jun@teamfremshop.com',   true),
  ('jk@fremdirect.com',      true),
  ('j.kim@getfrem.com',      false),
  ('june@frempartnerhub.com', false);

insert into campaigns (channel, name, active) values
  ('woodpecker_email', 'The "Welcome Back" (Past Buyers)',    true),
  ('woodpecker_email', 'The "Abandoned Cart" (High Intent)',  true),
  ('woodpecker_email', 'Cold Campaign Home Decor',            false),
  ('faire_campaign',   '4th of July',                         false),
  ('faire_campaign',   'Faire Week (manual)',                 false),
  ('faire_campaign',   'After Faire Event',                   false),
  ('faire_campaign',   'Back to School',                      true);
