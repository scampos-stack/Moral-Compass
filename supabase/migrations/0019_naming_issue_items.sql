-- Which items each naming warning actually affects.
--
-- 0016 reports that "One" and "ONE" collide across 3,693 variants. That is
-- the right headline and the wrong worklist: the person who has to fix it
-- needs the SKUs, not the count. This view is the drill-down — one row per
-- affected variant, carrying the exact spelling that variant uses, so a
-- fixer can filter to "everything typed ONE" and correct only those.
--
-- Deliberately NOT loaded with the page. The biggest issue alone would ship
-- 3,693 rows, and there are 19 issues. The page asks for one issue's items
-- when someone opens it, and the CSV export asks for all of them on demand.

drop view if exists v_naming_issue_items cascade;
create view v_naming_issue_items with (security_invoker = on) as
with vals as (
  select 'Product name' as scope, product_title as raw, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(product_title), '') is not null
  union all
  select 'Option value', option1, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option1), '') is not null
  union all
  select 'Option value', option2, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option2), '') is not null
  union all
  select 'Option value', option3, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(option3), '') is not null
  union all
  select 'Vendor', vendor, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(vendor), '') is not null
  union all
  select 'SKU', sku, variant_id
    from shopify_inventory
   where product_status = 'active' and nullif(btrim(sku), '') is not null
),
keyed as (
  select
    scope,
    raw,
    btrim(regexp_replace(upper(raw), '[^A-Z0-9]+', ' ', 'g')) as norm_key,
    variant_id
  from vals
),
-- Only the keys that actually collide. Without this the view would return
-- every value in the catalogue, most of them typed exactly one way.
colliding as (
  select scope, norm_key
  from keyed
  where norm_key <> ''
  group by scope, norm_key
  having count(distinct raw) > 1
)
select distinct
  k.scope,
  k.norm_key,
  k.raw            as typed_as,
  i.variant_id,
  i.sku,
  i.product_title,
  i.variant_title,
  i.vendor,
  i.available
from keyed k
join colliding c on c.scope = k.scope and c.norm_key = k.norm_key
join shopify_inventory i on i.variant_id = k.variant_id
order by k.scope, k.norm_key, k.raw, i.sku;

grant  select on v_naming_issue_items to authenticated;
revoke select on v_naming_issue_items from anon;
