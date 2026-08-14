-- DESTRUCTIVE. Drops every object created by 0001_init.sql and
-- 0002_ownership.sql, so those migrations can be run again from clean.
--
-- Run this ONLY while the schema is still being established and holds no data
-- worth keeping. Once real synced orders exist, fix forward with a new
-- migration instead — this script deletes them without asking.
--
-- Why it exists: the Supabase SQL Editor does not wrap a multi-statement
-- script in a transaction. A script that fails halfway leaves everything
-- before the failure committed, so re-running it hits
-- "relation already exists" on the objects that did get created.
--
-- Scoped to named objects on purpose. `drop schema public cascade` would also
-- remove Supabase's own machinery.

-- Views first — they depend on the tables.
drop view if exists v_migration_rate      cascade;
drop view if exists v_retailer_journey    cascade;
drop view if exists v_outreach_daily_all  cascade;
drop view if exists v_channel_performance cascade;

drop function if exists attribute_orders(integer)      cascade;
drop function if exists link_prospects_to_retailers()  cascade;
drop function if exists normalize_company_name(text)   cascade;

-- Tables, children before parents.
drop table if exists order_attributions       cascade;
drop table if exists prospect_retailer_links  cascade;
drop table if exists orders                   cascade;
drop table if exists touches                  cascade;
drop table if exists prospects                cascade;
drop table if exists retailers                cascade;
drop table if exists outreach_daily           cascade;
drop table if exists linkedin_daily           cascade;
drop table if exists campaigns                cascade;
drop table if exists sending_domains          cascade;
drop table if exists sync_runs                cascade;

-- Types last; the tables above depend on them.
drop type if exists match_method    cascade;
drop type if exists sales_channel   cascade;
drop type if exists order_state     cascade;
drop type if exists reply_sentiment cascade;
drop type if exists touch_kind      cascade;
drop type if exists channel         cascade;
