-- ============================================================
--  CFB PICKEM — database schema  (v2: commissioner-entry model)
--  Postgres / Supabase.  Season 2026-27.
--
--  WHAT CHANGED FROM v1
--    - No shot clock, no auto-skip, no bot. Turn order lives in
--      the group text; the app records picks, it doesn't police
--      them.
--    - One person (the commissioner) enters picks for everybody.
--      No logins in v1.
--    - PICKS ARE EDITABLE, with a full audit trail.
--    - Lines can be entered by hand, because a pick relayed over
--      text was agreed at the line quoted in the text, not the
--      line showing when it gets typed in.
-- ============================================================


-- ------------------------------------------------------------
--  1. PLAYERS
-- ------------------------------------------------------------
-- email is nullable: nobody logs in yet. It's here so that adding
-- logins later is a backfill, not a migration.
create table players (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null unique,
  email           text        unique,
  is_commissioner boolean     not null default false,
  created_at      timestamptz not null default now()
);


-- ------------------------------------------------------------
--  2. SEASONS
-- ------------------------------------------------------------
create table seasons (
  id        uuid primary key default gen_random_uuid(),
  label     text    not null unique,          -- '26-27'
  stake_usd numeric not null default 10,      -- $10 per game
  is_active boolean not null default false
);


-- ------------------------------------------------------------
--  3. SEASON_PLAYERS — who's in the pool this season
-- ------------------------------------------------------------
-- Payouts count rows here rather than hardcoding an opponent
-- count. This is the specific bug that broke the spreadsheet when
-- a sixth player was added.
create table season_players (
  season_id  uuid not null references seasons(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  base_order int  not null check (base_order >= 1),
  primary key (season_id, player_id),
  unique (season_id, base_order)
);


-- ------------------------------------------------------------
--  4. PERIODS — a "week", including bowl rounds
-- ------------------------------------------------------------
create table periods (
  id               uuid primary key default gen_random_uuid(),
  season_id        uuid not null references seasons(id) on delete cascade,
  seq              int  not null check (seq >= 1),
  label            text not null,                  -- 'Wk 0-1', 'Chmp'
  picks_per_player int  not null default 2 check (picks_per_player >= 1),
  status           text not null default 'upcoming'
                   check (status in ('upcoming','open','locked','final')),
  unique (season_id, seq)
);


-- ------------------------------------------------------------
--  5. GAMES — the slate, refreshed from The Odds API
-- ------------------------------------------------------------
-- current_spread / current_total are the cached live numbers shown
-- in the picker. They move all week. They are NOT what a pick is
-- graded against — picks.line is.
create table games (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references periods(id) on delete cascade,
  external_id    text not null,
  home_team      text not null,
  away_team      text not null,
  kickoff        timestamptz not null,

  current_spread numeric(4,1),      -- home team's number, e.g. -7.0
  current_total  numeric(4,1),
  lines_updated  timestamptz,

  home_score     int,
  away_score     int,
  period_clock   text,              -- '3rd 04:12', for the live dashboard
  scores_updated timestamptz,       -- last ESPN sync; throttles the dashboard
  status         text not null default 'scheduled'
                 check (status in ('scheduled','in_progress','final','cancelled')),

  unique (period_id, external_id)
);

create index games_period_kickoff_idx on games (period_id, kickoff);


-- ------------------------------------------------------------
--  6. PICKS
-- ------------------------------------------------------------
-- One row = one claimed slot. Four slots per game:
--   spread/home, spread/away, total/over, total/under
create table picks (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references periods(id) on delete cascade,
  player_id   uuid not null references players(id),
  game_id     uuid not null references games(id),

  market      text not null check (market in ('spread','total')),
  side        text not null check (side in ('home','away','over','under')),

  -- The number this pick is graded against. Frozen at entry, then
  -- only ever changed through an explicit edit (which is logged).
  line        numeric(4,1) not null,
  price       int not null default -110,

  -- 'api'    = taken from the cached live line
  -- 'manual' = the commissioner typed it, because that's the number
  --            actually agreed in the group text
  line_source text not null default 'api' check (line_source in ('api','manual')),

  pick_number int,                  -- draft slot 1..12; nullable, not enforced
  picked_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  result      text check (result in ('win','loss','push','void')),
  graded_at   timestamptz,

  constraint market_side_agree check (
    (market = 'spread' and side in ('home','away')) or
    (market = 'total'  and side in ('over','under'))
  ),

  -- Slot exclusivity, enforced by the database. Survives edits: moving
  -- a pick onto a slot someone else holds fails here, not in app code.
  constraint slot_taken_once unique (period_id, game_id, market, side),

  constraint one_pick_per_slot unique (period_id, pick_number)
);

create index picks_period_player_idx on picks (period_id, player_id);


-- ------------------------------------------------------------
--  6b. APP_STATE — small key/value scratchpad
-- ------------------------------------------------------------
-- Remembers things between requests. Right now: how many Odds API
-- credits are left this month, so the picker can stop refreshing
-- lines before we run out rather than after.
create table app_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);


-- ------------------------------------------------------------
--  7. PICK_EDITS — the audit trail
-- ------------------------------------------------------------
-- Ryan: "people will inevitably want to change their pick and we
-- allow it sometimes." Allowing it is easy; remembering exactly
-- what changed and when is what stops the argument in November.
-- Every change is recorded automatically by the trigger below.
create table pick_edits (
  id         uuid primary key default gen_random_uuid(),
  pick_id    uuid references picks(id) on delete set null,
  period_id  uuid not null references periods(id) on delete cascade,
  player_id  uuid not null references players(id),
  action     text not null check (action in ('create','update','delete')),

  old_desc   text,            -- 'Alabama -7.0 (-110)'
  new_desc   text,
  note       text,            -- optional: why it was allowed
  created_at timestamptz not null default now()
);

create index pick_edits_period_idx on pick_edits (period_id, created_at desc);


-- '7.5' stays '7.5'; '7.0' becomes '7', not '7.' (to_char leaves the dot).
create or replace function num(n numeric) returns text
language sql immutable as $$
  select trim(trailing '.' from trim(to_char(n,'FM990.9')));
$$;

-- Spreads always carry an explicit sign: '-7', '+3.5', 'PK'.
create or replace function sgn(n numeric) returns text
language sql immutable as $$
  select case when n = 0 then 'PK'
              when n > 0 then '+' || num(n)
              else num(n) end;
$$;

-- Human-readable description of a pick, for the audit log and the UI.
create or replace function describe_pick(
  p_game_id uuid, p_market text, p_side text, p_line numeric, p_price int
) returns text language sql stable as $$
  select case
    when p_market = 'spread' and p_side = 'home'
      then g.home_team || ' ' || sgn(p_line)
    when p_market = 'spread' and p_side = 'away'
      then g.away_team || ' ' || sgn(p_line)
    when p_side = 'over'  then 'Over '  || num(p_line)
    else                       'Under ' || num(p_line)
  end || ' (' || case when p_price > 0 then '+' else '' end || p_price || ')'
  from games g where g.id = p_game_id;
$$;


-- Did this edit actually change the BET, as opposed to bookkeeping?
create or replace function bet_changed(o picks, n picks)
returns boolean language sql immutable as $$
  select (o.game_id, o.market, o.side, o.line, o.price, o.player_id)
         is distinct from
         (n.game_id, n.market, n.side, n.line, n.price, n.player_id);
$$;

-- BEFORE: stamp updated_at. Must be BEFORE — it modifies the row.
create or replace function touch_pick() returns trigger
language plpgsql as $$
begin
  if bet_changed(old, new) then new.updated_at := now(); end if;
  return new;
end $$;

create trigger picks_touch
  before update on picks
  for each row execute function touch_pick();

-- AFTER: write the audit row. Must be AFTER — on INSERT the pick row
-- doesn't exist yet, so the foreign key would fail. On DELETE the pick
-- is already gone, so pick_id is left null and the description carries
-- the record.
create or replace function log_pick_edit() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT') then
    insert into pick_edits (pick_id, period_id, player_id, action, new_desc)
    values (new.id, new.period_id, new.player_id, 'create',
            describe_pick(new.game_id,new.market,new.side,new.line,new.price));

  elsif (tg_op = 'UPDATE') then
    if bet_changed(old, new) then
      insert into pick_edits (pick_id, period_id, player_id, action, old_desc, new_desc)
      values (new.id, new.period_id, new.player_id, 'update',
              describe_pick(old.game_id,old.market,old.side,old.line,old.price),
              describe_pick(new.game_id,new.market,new.side,new.line,new.price));
    end if;

  else
    insert into pick_edits (pick_id, period_id, player_id, action, old_desc)
    values (null, old.period_id, old.player_id, 'delete',
            describe_pick(old.game_id,old.market,old.side,old.line,old.price));
  end if;
  return null;
end $$;

create trigger picks_audit
  after insert or update or delete on picks
  for each row execute function log_pick_edit();


-- ============================================================
--  DRAFT ORDER  (displayed, never enforced)
-- ============================================================
-- Order still rotates — it's part of the game — but the app only
-- SHOWS whose turn it is. Nothing blocks an out-of-order entry,
-- because the real sequencing happens in the group text.
--
--   Wk 0-1 : Luke  Ryan  Nick  Mark  Steve Scott
--   Wk 2   : Ryan  Nick  Mark  Steve Scott Luke
--
-- If your league rotates the other way, flip the minus to a plus.
create or replace function draft_position(
  p_base_order int, p_seq int, p_n int
) returns int language sql immutable as $$
  select (((p_base_order - p_seq) % p_n) + p_n) % p_n + 1;
$$;

create or replace function draft_board(p_period_id uuid)
returns table (pick_number int, round int, player_id uuid, name text)
language sql stable as $$
  with p as (
    select pe.id, pe.seq, pe.season_id, pe.picks_per_player
    from periods pe where pe.id = p_period_id
  ),
  roster as (
    select sp.player_id, pl.name, sp.base_order, count(*) over () as n
    from season_players sp
    join players pl on pl.id = sp.player_id
    join p on p.season_id = sp.season_id
  ),
  ordered as (
    select r.player_id, r.name,
           draft_position(r.base_order, p.seq, r.n::int) as pos, r.n
    from roster r cross join p
  ),
  rounds as (select generate_series(1,(select picks_per_player from p)) as round)
  select ((rd.round - 1) * o.n + o.pos)::int, rd.round::int, o.player_id, o.name
  from ordered o cross join rounds rd
  order by 1;
$$;


-- ============================================================
--  THE THREE PAGES
-- ============================================================

-- ---- PAGE 1: the picker ------------------------------------
-- Every slot on the slate with its live line and who owns it.
-- NULL owner = still available. A game past kickoff is dead.
create or replace view slot_board as
select g.period_id, g.id as game_id, g.external_id,
       g.away_team, g.home_team, g.kickoff, g.status,
       s.market, s.side,
       case when s.market = 'spread' and s.side = 'home' then g.current_spread
            when s.market = 'spread' and s.side = 'away' then -g.current_spread
            else g.current_total end as current_line,
       pk.id as pick_id, pl.name as owner, pk.line as locked_line, pk.result,
       (pk.id is null and g.kickoff > now() and g.status = 'scheduled') as available
from games g
cross join (values ('spread','home'),('spread','away'),
                   ('total','over'),('total','under')) as s(market,side)
left join picks pk on pk.game_id = g.id
                  and pk.market = s.market and pk.side = s.side
left join players pl on pl.id = pk.player_id;


-- ---- PAGE 2: the live dashboard ----------------------------
-- Only games somebody actually picked, with the live score and
-- whether each pick is currently covering.
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
       end as margin          -- > 0 covering, < 0 losing, = 0 push
from picks pk
join games g   on g.id = pk.game_id
join players pl on pl.id = pk.player_id;


-- ---- PAGE 3: the scoreboard (the spreadsheet, reproduced) ----
-- One row per player per period: W and L, exactly like the grid.
create or replace view weekly_grid as
select pe.season_id, pe.seq, pe.label as period, pl.name,
       count(*) filter (where pk.result = 'win')  as w,
       count(*) filter (where pk.result = 'loss') as l
from periods pe
join season_players sp on sp.season_id = pe.season_id
join players pl on pl.id = sp.player_id
left join picks pk on pk.period_id = pe.id and pk.player_id = pl.id
                  and pk.result is not null
group by pe.season_id, pe.seq, pe.label, pl.name;


-- Starts from season_players (the roster), not picks -- a player with
-- zero graded picks so far must still show up as a real 0-0, not be
-- missing entirely. Missing rows here undercounts `n` in payouts below
-- (silently, until the pool is fully graded) -- the exact class of bug
-- that broke the original spreadsheet, just arrived at a different way.
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


-- THE PAYOUT FORMULA — reverse-engineered from Betting Pool.xlsx and
-- verified against all four historical seasons:
--
--     net $ = stake × Σ over each opponent of [ (your W−L) − (their W−L) ]
--           = stake × [ n × (your W−L) − (pool's total W−L) ]
--
-- n is COUNTED, never hardcoded. That is the whole point.
create or replace view payouts as
with agg as (
  select r.season_id, r.player_id, r.wins, r.losses, r.net_units,
         count(*)         over (partition by r.season_id) as n,
         sum(r.net_units) over (partition by r.season_id) as pool_net
  from player_records r
)
select a.season_id, s.label as season, a.player_id, pl.name,
       a.wins, a.losses, a.net_units,
       (s.stake_usd * (a.n * a.net_units - a.pool_net))::numeric as net_usd
from agg a
join seasons s  on s.id = a.season_id
join players pl on pl.id = a.player_id;


-- ---- PAGE 4: the Weekend Preview -----------------------------
-- A sassy AI-generated summary of the week's picks, regenerated every
-- Saturday morning, plus one confident "Lock of the Week" call. Nothing
-- computed is duplicated: lock_pick_id points at a real row in picks, so
-- whether the call hit is read back through the join below, never stored
-- twice -- the same "never store computed totals" rule the payout views
-- already follow.
create table weekend_previews (
  id           uuid primary key default gen_random_uuid(),
  period_id    uuid not null references periods(id) on delete cascade unique,
  generated_at timestamptz not null default now(),

  intro        text  not null,
  players      jsonb not null,   -- [{ "name": "...", "blurb": "..." }, ...]

  lock_pick_id uuid references picks(id),
  lock_call    text check (lock_call in ('win','lose')),
  lock_blurb   text
);

-- Whether each week's AI Lock actually hit, joined back to the real pick.
-- A push is neither a hit nor a miss -- excluded, same as everywhere else
-- pushes are voided.
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
