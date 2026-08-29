-- Run after schema.sql (and any earlier migrate-*.sql). Safe to run twice.
--
-- Fixes player_records to include every player in the roster (via
-- season_players), not just players who already have at least one graded
-- pick. Before this, early in a season -- when some players haven't had
-- anything grade yet -- payouts.n (the opponent count) silently came out
-- too small, understating (or in the worst case, zeroing out) what
-- everyone actually owed. The full commentary is in db/schema.sql where
-- this view is defined.
create or replace view player_records as
select sp.season_id, sp.player_id,
       count(pk.id) filter (where pk.result = 'win')  as wins,
       count(pk.id) filter (where pk.result = 'loss') as losses,
       count(pk.id) filter (where pk.result = 'push') as pushes,
       count(pk.id) filter (where pk.result = 'win')
         - count(pk.id) filter (where pk.result = 'loss') as net_units
from season_players sp
join periods pe on pe.season_id = sp.season_id
left join picks pk on pk.period_id = pe.id and pk.player_id = sp.player_id
                   and pk.result is not null
group by sp.season_id, sp.player_id;
