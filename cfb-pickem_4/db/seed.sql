-- ============================================================
--  SEED — run ONCE, after schema.sql
--  Creates the six players, the 26-27 season, and all 18 periods.
-- ============================================================

insert into players (name, is_commissioner) values
  ('Luke',false),('Ryan',true),('Nick',false),
  ('Mark',false),('Steve',false),('Scott',false)
on conflict (name) do nothing;

insert into seasons (label, stake_usd, is_active) values ('26-27', 10, true)
on conflict (label) do nothing;

-- Week 1 draft order. Everything else rotates from this.
insert into season_players (season_id, player_id, base_order)
select s.id, p.id, v.ord
from seasons s, players p,
     (values ('Luke',1),('Ryan',2),('Nick',3),
             ('Mark',4),('Steve',5),('Scott',6)) v(nm,ord)
where s.label = '26-27' and p.name = v.nm
on conflict do nothing;

-- 18 periods. Week 0 and Week 1 are drafted together as seq 1.
--
-- window_start/window_end are this season's REAL calendar dates for each
-- week -- Tue-Mon, 7 days apart, after the irregular 12-day Wk 0-1 opener.
-- These scope which games an odds refresh imports for a period and which
-- ones the Picks page shows for it (see lib/lines.ts, app/page.tsx) --
-- without them, a refresh has no way to tell "this week's games" from
-- "everything left on the schedule," which is exactly what let Week 2 and
-- Week 3's games bleed into Week 4's Picks tab once. The postseason rows
-- (Chmp/Bowl 1/Bowl 2/CFB) are left NULL on purpose -- those dates aren't
-- set until the season is underway; a null window means "don't filter,"
-- which is safe there since the regular season's games are long done by
-- the time any of those periods open. RUNNING THIS FOR A LATER SEASON:
-- these are 26-27-specific calendar dates, not a formula -- update them.
insert into periods (season_id, seq, label, picks_per_player, status, window_start, window_end)
select s.id, v.seq, v.label, v.ppp, v.st, v.ws, v.we
from seasons s, (values
  (1,'Wk 0-1',2,'open',      '2026-08-27'::date, '2026-09-07'::date),
  (2,'Wk 2',2,'upcoming',    '2026-09-08'::date, '2026-09-14'::date),
  (3,'Wk 3',2,'upcoming',    '2026-09-15'::date, '2026-09-21'::date),
  (4,'Wk 4',2,'upcoming',    '2026-09-22'::date, '2026-09-28'::date),
  (5,'Wk 5',2,'upcoming',    '2026-09-29'::date, '2026-10-05'::date),
  (6,'Wk 6',2,'upcoming',    '2026-10-06'::date, '2026-10-12'::date),
  (7,'Wk 7',2,'upcoming',    '2026-10-13'::date, '2026-10-19'::date),
  (8,'Wk 8',2,'upcoming',    '2026-10-20'::date, '2026-10-26'::date),
  (9,'Wk 9',2,'upcoming',    '2026-10-27'::date, '2026-11-02'::date),
  (10,'Wk 10',2,'upcoming',  '2026-11-03'::date, '2026-11-09'::date),
  (11,'Wk 11',2,'upcoming',  '2026-11-10'::date, '2026-11-16'::date),
  (12,'Wk 12',2,'upcoming',  '2026-11-17'::date, '2026-11-23'::date),
  (13,'Wk 13',2,'upcoming',  '2026-11-24'::date, '2026-11-30'::date),
  (14,'Wk 14',2,'upcoming',  '2026-12-01'::date, '2026-12-07'::date),
  (15,'Chmp',1,'upcoming',   null, null),
  (16,'Bowl 1',1,'upcoming', null, null),
  (17,'Bowl 2',2,'upcoming', null, null),
  (18,'CFB',2,'upcoming',    null, null)
) v(seq,label,ppp,st,ws,we)
where s.label = '26-27'
on conflict (season_id, seq) do nothing;
