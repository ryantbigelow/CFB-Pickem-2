-- Run after schema.sql (and migrate-001/002 if you're on an older install).
-- Safe to run twice: `create table if not exists` and `create or replace
-- view` both no-op harmlessly on a rerun.
--
-- Adds the Weekend Preview: a sassy AI-generated summary of the week's
-- picks, regenerated every Saturday morning, plus one confident "Lock of
-- the Week" call. See db/schema.sql's "PAGE 4" section for the full
-- commentary -- this file is that same DDL, just standalone for an
-- existing database.

create table if not exists weekend_previews (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade unique,
  generated_at timestamptz not null default now(),

  intro        text  not null,
  players      jsonb not null,

  lock_pick_id uuid references picks(id),
  lock_call    text check (lock_call in ('win','lose')),
  lock_blurb   text
);

create or replace view weekend_preview_locks as
select
  wp.id, wp.period_id, s.id as season_id, s.label as season,
  pe.seq, pe.label as period,
  pl.name as player,
  describe_pick(pk.game_id, pk.market, pk.side, pk.line, pk.price) as bet,
  wp.lock_call, pk.result,
  case
    when pk.result is null or pk.result in ('push','void') then null
    when wp.lock_call = 'win'  and pk.result = 'win'  then true
    when wp.lock_call = 'lose' and pk.result = 'loss' then true
    else false
  end as call_correct,
  wp.lock_blurb, wp.generated_at
from weekend_previews wp
join periods pe on pe.id = wp.period_id
join seasons s  on s.id = pe.season_id
left join picks pk   on pk.id = wp.lock_pick_id
left join players pl on pl.id = pk.player_id
order by pe.seq;
