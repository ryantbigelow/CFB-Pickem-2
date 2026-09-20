-- Run after schema.sql (and any earlier migrate-*.sql). Safe to run twice.
--
-- Adds games.espn_id, so the Scoreboard page can link each game card to its
-- real ESPN game page. lib/sync.ts already fetches this id from ESPN on
-- every match (fetchScores()'s espnId) but had nowhere to put it -- this
-- gives it one. Existing rows start out NULL and backfill themselves the
-- next time the Scoreboard page (or /api/refresh) syncs scores for them.
alter table games add column if not exists espn_id text;

-- espn_id MUST be the last column here -- Postgres's CREATE OR REPLACE VIEW
-- refuses to insert a new column anywhere else, because it reads that as
-- renaming every column that comes after it (this is exactly what failed
-- the first time this migration ran: "cannot change name of view column
-- 'market' to 'espn_id'").
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
       g.espn_id
from picks pk
join games g   on g.id = pk.game_id
join players pl on pl.id = pk.player_id;
