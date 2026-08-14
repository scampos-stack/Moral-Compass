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
