-- Run after schema.sql (and any earlier migrate-*.sql). Safe to run twice.
--
-- Adds periods.window_start/window_end -- the real calendar dates each
-- week's games fall in -- and backfills them for the 26-27 season's
-- regular-season weeks (the postseason rows are left NULL; their dates
-- aren't set yet, see the comment in db/schema.sql and db/seed.sql).
--
-- Without this, an odds refresh had no way to tell "this week's games"
-- from "everything left on the schedule" -- which is exactly what let
-- Week 2 and Week 3's games bleed into Week 4's Picks tab. lib/lines.ts
-- and app/page.tsx both now use this window once it's set.
alter table periods add column if not exists window_start date;
alter table periods add column if not exists window_end date;

update periods set window_start = '2026-08-27', window_end = '2026-09-07'
where seq = 1 and season_id = (select id from seasons where label = '26-27');

update periods set
  window_start = ('2026-09-08'::date + ((seq - 2) * 7)),
  window_end   = ('2026-09-08'::date + ((seq - 2) * 7) + 6)
where seq between 2 and 14
  and season_id = (select id from seasons where label = '26-27');

-- slot_board also now exposes espn_id, for the Picks page's ESPN links
-- (see the matching app/picker.tsx change) -- appended at the end of the
-- select list, never in the middle: see db/migrate-005.sql's comment for
-- why CREATE OR REPLACE VIEW requires that.
create or replace view slot_board as
select g.period_id, g.id as game_id, g.external_id,
       g.away_team, g.home_team, g.kickoff, g.status,
       s.market, s.side,
       case when s.market = 'spread' and s.side = 'home' then g.current_spread
            when s.market = 'spread' and s.side = 'away' then -g.current_spread
            else g.current_total end as current_line,
       pk.id as pick_id, pl.name as owner, pk.line as locked_line, pk.result,
       (pk.id is null and g.kickoff > now() and g.status = 'scheduled') as available,
       g.espn_id
from games g
cross join (values ('spread','home'),('spread','away'),
                   ('total','over'),('total','under')) as s(market,side)
left join picks pk on pk.game_id = g.id
                  and pk.market = s.market and pk.side = s.side
left join players pl on pl.id = pk.player_id;
