-- Real LinkedIn activity, transcribed from the "Starting connection" tab of
-- the tracking sheet (read 2026-08-14). Only days with recorded activity are
-- included; blank rows in the sheet are absent here rather than stored as
-- zeros, because "no outreach" and "not filled in" are different facts.
--
-- Idempotent: re-running updates rather than duplicating.
--
-- Note the sheet disagrees with itself. The Performance Table reports 185
-- LinkedIn touches, and Total Outreach reports 126, but the daily tab below
-- sums to roughly 800. The daily tab is the primary record — it is where a
-- human writes the number the same day — so it is what gets loaded. Worth
-- resolving with whoever maintains the summary formulas.

insert into linkedin_daily (
  activity_date, connections_sent, connections_accepted, inmails,
  replies_positive, replies_neutral, replies_negative, notes
) values
  ('2026-06-15', 25,  6, 0, 1, 0, 0, null),
  ('2026-06-16', 25,  4, 0, 0, 0, 0, null),
  ('2026-06-17', 20,  1, 3, 0, 0, 0, 'plus 3 InMails'),
  ('2026-06-18', 20,  5, 0, 0, 0, 0, null),
  ('2026-06-22', 25,  6, 0, 0, 1, 0, null),
  ('2026-06-29', 27,  6, 0, 0, 0, 0, null),
  ('2026-06-30', 25,  2, 0, 0, 0, 0, null),
  ('2026-07-02', 24,  5, 0, 0, 0, 0, null),
  ('2026-07-07', 45,  4, 0, 0, 0, 0, null),
  ('2026-07-08',  0,  0, 0, 0, 0, 0, 'Platos follow ups and InMails'),
  ('2026-07-09', 34,  9, 0, 0, 0, 0, 'New profile picture'),
  ('2026-07-10', 25,  9, 0, 0, 0, 0, null),
  ('2026-07-13', 35,  5, 0, 0, 0, 0, null),
  ('2026-07-14', 26,  3, 0, 0, 0, 0, null),
  ('2026-07-15', 25,  3, 0, 0, 0, 0, 'blank connection'),
  ('2026-07-16', 45,  2, 4, 1, 0, 0, 'open to connect?'),
  ('2026-07-17', 10,  2, 0, 0, 0, 0, null),
  ('2026-07-20', 20,  8, 0, 2, 0, 0, null),
  ('2026-07-21', 33,  9, 0, 0, 0, 0, null),
  ('2026-07-22', 36, 13, 0, 1, 0, 0, null),
  ('2026-07-23', 32,  6, 0, 1, 0, 0, null),
  ('2026-07-24', 25, 18, 0, 1, 0, 0, null),
  ('2026-07-27', 25,  7, 0, 1, 0, 0, null),
  ('2026-07-28', 30,  4, 0, 1, 0, 0, null),
  ('2026-07-29', 30, 16, 0, 1, 0, 0, 'starting optimization'),
  ('2026-07-30', 25,  7, 0, 0, 0, 0, null),
  ('2026-08-03', 35,  3, 0, 0, 0, 0, null),
  ('2026-08-04', 25,  6, 0, 0, 0, 0, null),
  ('2026-08-05', 25,  6, 0, 1, 0, 0, null),
  ('2026-08-06', 25,  3, 0, 0, 0, 0, null),
  ('2026-08-10', 12,  7, 0, 0, 0, 0, null),
  ('2026-08-11', 25,  0, 0, 0, 0, 0, 'accepted not yet recorded')
on conflict (activity_date) do update set
  connections_sent     = excluded.connections_sent,
  connections_accepted = excluded.connections_accepted,
  inmails              = excluded.inmails,
  replies_positive     = excluded.replies_positive,
  replies_neutral      = excluded.replies_neutral,
  replies_negative     = excluded.replies_negative,
  notes                = excluded.notes,
  updated_at           = now();
