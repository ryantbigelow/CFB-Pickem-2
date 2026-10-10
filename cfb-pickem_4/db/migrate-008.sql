-- Run after schema.sql (and any earlier migrate-*.sql). Safe to run twice.
--
-- Adds games.tv -- the broadcast channel ('ABC', 'ESPN / ESPN2'), pulled
-- from the same ESPN event that already supplies scores and espn_id
-- (lib/scores.ts) -- so the Scoreboard card can show where to watch.
-- Null until ESPN publishes it (TV assignments usually land a week or so
-- before kickoff); every score sync re-checks, so it fills itself in.
alter table games add column if not exists tv text;

-- Appended at the END of live_picks' select list, never in the middle:
-- see db/migrate-005.sql's comment for why CREATE OR REPLACE VIEW
-- requires that.
create or replace view live_picks as
select pk.id as pick_id, g.period_id, pl.name as player,
       g.away_team, g.home_team, g.away_score, g.home_score,
       g.status, g.period_clock, g.kickoff,
       pk.market, pk.side, pk.line, pk.result,
       describe_pick(pk.game_id, pk.market, pk.side, pk.line, pk.price) as bet,
       case
         when g.home_score is null then null
         when pk.market = 'spread' and pk.side = 'home'
              then (g.home_score - g.away_score) + pk.line
         when pk.market = 'spread' and pk.side = 'away'
              then (g.away_score - g.home_score) + pk.line
         when pk.side = 'over'  then (g.home_score + g.away_score) - pk.line
         else pk.line - (g.home_score + g.away_score)
       end as margin,
       g.espn_id,
       g.tv
from picks pk
join games g   on g.id = pk.game_id
join players pl on pl.id = pk.player_id;
