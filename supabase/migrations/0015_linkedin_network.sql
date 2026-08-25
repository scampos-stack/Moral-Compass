-- Derive accepted connections from network size.
--
-- Counting acceptances by hand is tedious and error-prone. LinkedIn shows a
-- running connection total, so the day's acceptances are simply today's total
-- minus the last one recorded — which is how the tracking sheet already did
-- it (=1046-1038).
--
-- Also drops accepted_within_sent. That constraint assumed acceptances come
-- from the SAME day's requests, which is wrong: someone accepts days or weeks
-- after the request, and inbound requests arrive independently. A day with 0
-- sent and 5 accepted is ordinary, and the constraint rejected it outright.
-- The sheet's own numbers show this — 12 sent / 7 accepted, 25 sent / 18
-- accepted — clearly drawing on a backlog rather than that morning's sends.

alter table linkedin_daily
  drop constraint if exists accepted_within_sent;

alter table linkedin_daily
  add column if not exists network_total integer
    check (network_total is null or network_total >= 0);

comment on column linkedin_daily.network_total is
  'Total LinkedIn connections on this date, read straight off the profile. Acceptances are derived as the difference from the previous recorded total.';

-- Accepted-per-day derived from the running total, for days where it was
-- captured. Falls back to the typed figure otherwise, so older hand-entered
-- rows keep working.
create or replace view v_linkedin_daily with (security_invoker = on) as
select
  d.activity_date,
  d.connections_sent,
  d.inmails,
  d.network_total,
  -- The previous total may be several days back: blank days are absent
  -- rather than zero, so "yesterday" is not always the row before.
  lag(d.network_total) over (
    order by d.activity_date
  ) as previous_network_total,
  case
    when d.network_total is not null
     and lag(d.network_total) over (order by d.activity_date) is not null
    -- greatest(...,0): a network total can fall when someone disconnects,
    -- and negative acceptances are not a thing.
    then greatest(
      d.network_total - lag(d.network_total) over (order by d.activity_date), 0)
    else d.connections_accepted
  end as connections_accepted,
  d.replies_positive,
  d.replies_neutral,
  d.replies_negative,
  d.replies_total,
  d.notes
from linkedin_daily d
order by d.activity_date desc;

grant select on v_linkedin_daily to authenticated;
revoke select on v_linkedin_daily from anon;
