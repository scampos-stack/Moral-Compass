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
