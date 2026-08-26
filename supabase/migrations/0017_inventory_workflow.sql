-- Inventory workflow: who ordered what, who claimed which cleanup, and the
-- stock that is hiding behind a duplicate SKU.
--
-- Two things this makes possible that 0016 could not. A reorder list that
-- only shows what still needs a decision, so the same 261 rows are not
-- re-read every morning. And a name for every action, so "someone should
-- fix the colours" becomes a person and a date.
--
-- ── On verification ──────────────────────────────────────────────────────
--
-- A naming problem cannot be fixed in this dashboard. It is fixed in
-- Shopify, and the next sync is what proves it. So a claim is deliberately
-- NOT a way to close a row: v_naming_issues is recomputed from the live
-- catalogue on every sync, and a claimed issue that is still there comes
-- back, now carrying how long ago it was claimed. Clicking cannot make the
-- row go away. Renaming the product can.

-- ── Reorder state ────────────────────────────────────────────────────────
--
-- A row exists only once someone has acted. "Open" is the absence of a row,
-- which means a variant that stops being low simply drops out of the alert
-- view and leaves no stale state behind.

create table if not exists inventory_reorder (
  variant_id  bigint primary key,
  status      text not null default 'ordered'
              check (status in ('ordered', 'received')),
  ordered_qty integer,
  ordered_at  timestamptz,
  received_at timestamptz,
  note        text,
  -- The signed-in email. Not a foreign key to auth.users: people leave, and
  -- the record of who placed an order must outlive their account.
  actor       text not null,
  updated_at  timestamptz not null default now()
);

create index if not exists inventory_reorder_status_idx
  on inventory_reorder (status);

-- ── Naming claims ────────────────────────────────────────────────────────
--
-- Keyed by the issue itself (scope + normalised value) rather than by a row
-- id, because v_naming_issues is a computed view with no stable identity.
-- Claim "Option value / ONE" and the claim survives a resync, which is
-- exactly what makes the unfixed ones visible.

create table if not exists naming_claim (
  scope      text not null,
  norm_key   text not null,
  actor      text not null,
  claimed_at timestamptz not null default now(),
  note       text,
  primary key (scope, norm_key)
);

alter table inventory_reorder enable row level security;
alter table naming_claim      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inventory_reorder', 'naming_claim'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t);
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ── Stock hiding behind a duplicate SKU ──────────────────────────────────
--
-- The one place where the catalogue mess costs money directly.
--
-- Naming collisions do NOT split stock: Shopify will not let one product
-- carry both "Blue" and "BLUE" as option values, and checking the live
-- catalogue found zero such cases. Duplicate SKUs are different. When four
-- variants share one code, each keeps its own count, so a buyer reading one
-- of them sees 0 while 253 units sit on a sibling.
--
-- Measured on the live catalogue: of 228 duplicate-SKU groups, 6 have one
-- sibling at or below the low line while another still holds stock. Those
-- six are reorders that should not be placed. A further 5 are low across
-- every sibling — genuinely short, and merely untidy.

drop view if exists v_masked_stock cascade;
create view v_masked_stock with (security_invoker = on) as
with grouped as (
  select
    sku_key,
    count(*)          as sharing,
    min(available)    as lowest,
    max(available)    as highest,
    sum(available)    as sku_total
  from shopify_inventory
  where product_status = 'active'
    and nullif(btrim(sku), '') is not null
  group by sku_key
  having count(*) > 1
     and min(available) <= 5
     and max(available) > 5
)
select
  i.variant_id,
  i.product_title,
  i.variant_title,
  i.sku,
  i.sku_key,
  i.available,
  g.sku_total,
  g.sharing,
  g.highest as sibling_highest
from shopify_inventory i
join grouped g on g.sku_key = i.sku_key
where i.product_status = 'active'
  and i.available <= 5
order by g.sku_total desc;

grant  select on v_masked_stock to authenticated;
revoke select on v_masked_stock from anon;
