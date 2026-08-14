-- Remove anonymous access to the whole dataset.
--
-- Supabase grants the `anon` role SELECT on public by default, so an
-- unauthenticated caller could reach every table and view here. RLS still
-- protected the rows — verified: anon reads returned empty — but
-- v_channel_performance answered with a zero-filled row rather than nothing,
-- because an ungrouped aggregate over a table you cannot see still yields one
-- row of zeros. Nothing sensitive escaped, yet the reachability is needless:
-- this is an internal dashboard and no part of it is public.
--
-- Defence in depth. RLS remains the real control; this removes the surface.

revoke select on all tables in schema public from anon;

-- Applies to anything added later, so a future table is not silently public.
alter default privileges in schema public revoke select on tables from anon;

-- Signed-in users keep read access; RLS decides which rows.
grant select on all tables in schema public to authenticated;

-- Only linkedin_daily is user-writable. Everything else is written by the
-- service role, which bypasses RLS and needs no grant.
grant insert, update on linkedin_daily to authenticated;

-- The helper routines run as the invoker, so they must not be callable by
-- anonymous requests either.
revoke execute on function attribute_orders(integer)     from anon;
revoke execute on function link_prospects_to_retailers()  from anon;
revoke execute on function normalize_company_name(text)   from anon;
