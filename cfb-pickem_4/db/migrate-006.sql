-- Run after schema.sql (and any earlier migrate-*.sql). Safe to run twice.
--
-- Adds next_picker(), which powers the "Up next" indicator on the Picks
-- page. See its comment in db/schema.sql for how it stays correct even
-- when someone picks out of turn -- nothing here restricts picking, it
-- only reports whose turn the announced order says it is.
create or replace function next_picker(p_period_id uuid)
returns table (player_id uuid, name text)
language sql stable as $$
  with counts as (
    select pk.player_id, count(*) as made
    from picks pk
    where pk.period_id = p_period_id
    group by pk.player_id
  )
  select db.player_id, db.name
  from draft_board(p_period_id) db
  left join counts c on c.player_id = db.player_id
  where coalesce(c.made, 0) < db.round
  order by db.pick_number
  limit 1;
$$;
