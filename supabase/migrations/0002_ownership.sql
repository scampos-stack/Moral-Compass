-- Buyer-relationship ownership, per the A-Teamwork proposal (March 2026).
--
-- 0001 answers "which outreach earned this revenue". This migration answers the
-- strategic question: "how much of the buyer base do we actually own?" Roughly
-- 77,000 relationships sit on Faire at 15% commission against ~4,000 owned on
-- Shopify. Moving orders leftward costs 15 cents on the dollar; the primary KPI
-- of the engagement is the rate at which they move rightward.

-- Ordered least-owned to most-owned so `order by` reads as migration progress.
create type sales_channel as enum (
  'faire_marketplace',  -- 15% commission, Faire owns the buyer
  'faire_direct',       -- 0% commission, transition bridge
  'shopify_direct'      -- 0% commission, fully owned
);

alter table orders
  add column sales_channel sales_channel not null default 'faire_marketplace',
  -- Faire's verbatim `source` (MARKETPLACE, FAIRE_DIRECT, …), kept unmapped
  -- alongside the normalised enum.
  add column raw_source text,
  -- Rate at the time of the order. Stored, not looked up: Faire can change its
  -- take and historical margin must not silently rewrite itself.
  add column commission_rate numeric(5, 4) not null default 0
    check (commission_rate >= 0 and commission_rate <= 1),
  -- Actual commission Faire charged, straight from payout_costs.commission.
  -- NOT computed from amount * rate: Faire applies flat fees and discounts, so
  -- the arithmetic estimate drifts from what was really taken.
  add column commission_paid numeric(12, 2) not null default 0
    check (commission_paid >= 0),
  -- What the brand actually receives after commission, payout fees and
  -- adjustments. The only figure that reflects real margin.
  add column net_payout numeric(12, 2);

create index on orders (sales_channel, placed_at desc);

comment on column orders.sales_channel is
  'Which channel captured the transaction. Drives the migration KPI. Derived from Faire''s `source` field: MARKETPLACE -> faire_marketplace (1500 bps), FAIRE_DIRECT -> faire_direct (0 bps).';

-- ── Linking outreach to Faire buyers ─────────────────────────────────────
--
-- The Faire order payload carries NO buyer email — only a first/last name and
-- the store's company name. Woodpecker, by contrast, is keyed entirely on
-- email. So there is no identifier common to both systems, and a prospect can
-- only be tied to a retailer by matching company names.
--
-- That match is fuzzy and therefore fallible, so it is recorded explicitly
-- rather than inferred at query time: every link states how it was made and
-- how much to trust it. Attribution built on a guessed link must be legible
-- as such.

create type match_method as enum (
  'exact_email',    -- a shared email; only ever from Shopify or the CRM
  'company_name',   -- normalised company names identical and unambiguous
  'contact_name',   -- buyer person-name identical and unambiguous
  'fuzzy_name',     -- similarity above threshold; review before trusting
  'manual'          -- a human confirmed it
);

-- Lowercase, strip punctuation and common retail suffixes, collapse spaces.
-- "Coral & Lace Boutique, LLC" and "coral and lace boutique" must converge.
create or replace function normalize_company_name(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(raw, '')), '\&', ' and ', 'g'),
        '\m(llc|inc|co|corp|ltd|the|boutique|shop|store)\M', ' ', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )),
    ''
  );
$$;

alter table retailers
  add column normalized_name text
    generated always as (normalize_company_name(name)) stored,
  add column normalized_contact text
    generated always as (
      normalize_company_name(contact_first_name || ' ' || contact_last_name)
    ) stored;

alter table prospects
  add column normalized_company text
    generated always as (normalize_company_name(company_name)) stored,
  add column normalized_contact text
    generated always as (
      normalize_company_name(first_name || ' ' || last_name)
    ) stored;

create index on retailers (normalized_name);
create index on retailers (normalized_contact);
create index on prospects (normalized_company);
create index on prospects (normalized_contact);

-- How each prospect→retailer link was established. Nullable FK on prospects
-- would hide this; a table forces the provenance to be recorded.
create table prospect_retailer_links (
  prospect_id uuid primary key references prospects (id) on delete cascade,
  retailer_id uuid not null references retailers (id) on delete cascade,
  method      match_method not null,
  confidence  numeric(3, 2) check (confidence between 0 and 1),
  linked_at   timestamptz not null default now()
);

create index on prospect_retailer_links (retailer_id);

alter table prospect_retailer_links enable row level security;

create policy prospect_retailer_links_read on prospect_retailer_links
  for select to authenticated using (true);

-- Links prospects to retailers on exact normalised equality, company name
-- first and buyer contact name second. Deliberately conservative: fuzzy
-- matching is left to a reviewed step, because a wrong link silently
-- misattributes revenue.
--
-- Both passes skip ambiguous names. If one normalised name maps to several
-- retailers, picking arbitrarily would fabricate an attribution — better to
-- leave the prospect unlinked and let a human decide.
create or replace function link_prospects_to_retailers()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
  total    integer := 0;
begin
  -- Pass 1: company name. The stronger signal — a store name identifies the
  -- buying entity, whereas a person may work anywhere.
  insert into prospect_retailer_links (prospect_id, retailer_id, method, confidence)
  select p.id, r.id, 'company_name', 0.90
  from prospects p
  join retailers r on r.normalized_name = p.normalized_company
  where p.normalized_company is not null
    and (select count(*) from retailers r2
         where r2.normalized_name = p.normalized_company) = 1
  on conflict (prospect_id) do nothing;

  get diagnostics affected = row_count;
  total := total + affected;

  -- Pass 2: buyer contact name, for prospects pass 1 left unlinked. Weaker —
  -- names collide far more than store names do — so it is scored lower and
  -- must stay distinguishable downstream.
  insert into prospect_retailer_links (prospect_id, retailer_id, method, confidence)
  select p.id, r.id, 'contact_name', 0.60
  from prospects p
  join retailers r on r.normalized_contact = p.normalized_contact
  where p.normalized_contact is not null
    and (select count(*) from retailers r2
         where r2.normalized_contact = p.normalized_contact) = 1
    and (select count(*) from prospects p2
         where p2.normalized_contact = p.normalized_contact) = 1
  on conflict (prospect_id) do nothing;

  get diagnostics affected = row_count;
  return total + affected;
end;
$$;

-- First order per retailer, so we can tell acquisition from migration.
create view v_retailer_journey with (security_invoker = on) as
select
  r.id as retailer_id,
  r.name,
  min(o.placed_at)                                as first_order_at,
  max(o.placed_at)                                as last_order_at,
  count(*)                                        as order_count,
  sum(o.amount)                                   as lifetime_revenue,
  sum(o.commission_paid)                          as lifetime_commission,
  -- The migration event we care about: they started on the marketplace and
  -- have since ordered through a channel Moral Compass owns.
  bool_or(o.sales_channel = 'faire_marketplace')  as ever_marketplace,
  bool_or(o.sales_channel <> 'faire_marketplace') as ever_direct,
  max(o.sales_channel)                            as furthest_channel
from retailers r
join orders o on o.retailer_id = r.id
where o.state <> 'cancelled'
group by r.id, r.name;

-- The proposal's primary KPI, by month. Two readings, because they diverge:
-- revenue share moves first (a few big direct orders), buyer share is the one
-- that actually reduces platform dependency.
create view v_migration_rate with (security_invoker = on) as
with monthly as (
  select
    date_trunc('month', placed_at)::date as month,
    sum(amount) filter (where sales_channel <> 'faire_marketplace') as direct_revenue,
    sum(amount)                                                     as total_revenue,
    count(distinct retailer_id) filter (where sales_channel <> 'faire_marketplace') as direct_buyers,
    count(distinct retailer_id)                                     as total_buyers,
    sum(commission_paid)                                            as commission_paid
  from orders
  where state <> 'cancelled'
  group by 1
)
select
  month,
  total_revenue,
  direct_revenue,
  case when total_revenue > 0
       then round(100.0 * direct_revenue / total_revenue, 2)
  end as revenue_migration_pct,
  total_buyers,
  direct_buyers,
  case when total_buyers > 0
       then round(100.0 * direct_buyers / total_buyers, 2)
  end as buyer_migration_pct,
  commission_paid,
  -- What the marketplace revenue would have cost nothing to earn, had it come
  -- through an owned channel. This is the number that justifies the project.
  round(commission_paid, 2) as commission_recoverable
from monthly
order by month desc;

-- ── Attribution, revised ─────────────────────────────────────────────────
--
-- Supersedes the 0001 definition. That version joined prospects to orders on
-- prospects.retailer_id, which assumed we could identify a Faire buyer
-- directly. We cannot — Faire exposes no email — so the join now runs through
-- prospect_retailer_links, and the recorded match method travels with the
-- attribution so a name-matched credit is never mistaken for a certain one.
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
      extract(epoch from (o.placed_at - t.sent_at)) / 3600.0 as hours_since,
      l.method
    from orders o
    join prospect_retailer_links l on l.retailer_id = o.retailer_id
    join prospects p on p.id = l.prospect_id
    join touches   t on t.prospect_id = p.id
    where t.sent_at <= o.placed_at
      and t.sent_at >= o.placed_at - make_interval(hours => window_hours)
    order by o.id, t.sent_at desc
  )
  insert into order_attributions (order_id, touch_id, channel, hours_since_touch, method)
  select order_id, touch_id, channel, round(hours_since, 2), 'last_touch:' || method
  from candidate
  on conflict (order_id) do update
    set touch_id          = excluded.touch_id,
        channel           = excluded.channel,
        hours_since_touch = excluded.hours_since_touch,
        computed_at       = now()
    where order_attributions.method <> 'manual';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Both views are declared `security_invoker = on` above. Postgres defaults
-- views to DEFINER rights, which would run them as the owner and quietly
-- bypass RLS on orders/retailers — invoker rights keep the caller's policies.
grant select on v_retailer_journey, v_migration_rate to authenticated;
