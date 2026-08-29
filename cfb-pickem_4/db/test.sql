\set ON_ERROR_STOP on
\pset footer off

insert into players (name, is_commissioner) values
 ('Luke',false),('Ryan',true),('Nick',false),('Mark',false),('Steve',false),('Scott',false);
insert into seasons (label, stake_usd, is_active) values ('26-27',10,true);
insert into season_players (season_id, player_id, base_order)
select s.id, p.id, v.ord from seasons s, players p,
 (values ('Luke',1),('Ryan',2),('Nick',3),('Mark',4),('Steve',5),('Scott',6)) v(nm,ord)
where s.label='26-27' and p.name=v.nm;
insert into periods (season_id, seq, label, status)
select id,1,'Wk 0-1','open' from seasons where label='26-27';

insert into games (period_id, external_id, home_team, away_team, kickoff,
                   current_spread, current_total, lines_updated)
select pe.id, v.eid, v.h, v.a, v.ko, v.sp, v.tot, now()
from periods pe, (values
 ('e1','Alabama','Auburn',   now()+interval '3 days', -7.0, 52.5),
 ('e2','Georgia','Clemson',  now()+interval '4 days', -3.5, 47.5),
 ('e3','Texas',  'Ohio State',now()+interval '5 days', 2.5, 55.5)
) v(eid,h,a,ko,sp,tot) where pe.seq=1;

\echo ''
\echo '=== TEST 1: picker board — 3 games x 4 slots = 12, all available ==='
select count(*) as slots, count(*) filter (where available) as available
from slot_board;

\echo ''
\echo '=== TEST 2: enter picks for players (commissioner model) ==='
insert into picks (period_id, player_id, game_id, market, side, line, pick_number)
select pe.id, pl.id, g.id, 'spread','home', -7.0, 1
from periods pe join games g on g.period_id=pe.id and g.external_id='e1', players pl
where pe.seq=1 and pl.name='Luke';

insert into picks (period_id, player_id, game_id, market, side, line, pick_number)
select pe.id, pl.id, g.id, 'spread','away', 7.0, 2
from periods pe join games g on g.period_id=pe.id and g.external_id='e1', players pl
where pe.seq=1 and pl.name='Ryan';

select owner, away_team||' @ '||home_team as game, market, side, locked_line
from slot_board where owner is not null order by owner;

\echo ''
\echo '=== TEST 3: Ryan changes his mind — edit the pick to a different game ==='
update picks set game_id = (select id from games where external_id='e2'),
                 market='total', side='over', line=47.5
where player_id=(select id from players where name='Ryan');

\echo '  audit trail:'
select pl.name, e.action, coalesce(e.old_desc,'-') as was, coalesce(e.new_desc,'-') as now
from pick_edits e join players pl on pl.id=e.player_id
order by e.created_at;

\echo ''
\echo '  Auburn +7 should be back on the board (Ryan vacated it):'
select away_team||' '||side as slot, owner, available
from slot_board where game_id=(select id from games where external_id='e1')
  and market='spread' and side='away';

\echo ''
\echo '=== TEST 4: manual line override (the number agreed in the group text) ==='
insert into picks (period_id, player_id, game_id, market, side, line, line_source, pick_number)
select pe.id, pl.id, g.id, 'spread','home', -5.5, 'manual', 3
from periods pe join games g on g.period_id=pe.id and g.external_id='e3', players pl
where pe.seq=1 and pl.name='Steve';
select pl.name, describe_pick(pk.game_id,pk.market,pk.side,pk.line,pk.price) as bet,
       pk.line_source, g.current_spread as live_line_now
from picks pk join players pl on pl.id=pk.player_id join games g on g.id=pk.game_id
where pk.line_source='manual';

\echo ''
\echo '=== TEST 5: editing onto a slot someone else owns must FAIL ==='
do $$
begin
  update picks set game_id=(select id from games where external_id='e1'),
                   market='spread', side='home', line=-7.0
  where player_id=(select id from players where name='Steve');
  raise exception 'TEST FAILED — collision allowed';
exception when unique_violation then
  raise notice '  REJECTED — Luke already owns Alabama -7  <-- correct';
end $$;

\echo ''
\echo '=== TEST 6: live dashboard — is each pick covering right now? ==='
update games set home_score=21, away_score=17, status='in_progress', period_clock='3rd 04:12'
where external_id='e1';
update games set home_score=14, away_score=28, status='in_progress', period_clock='2nd 08:40'
where external_id='e3';
select player, bet, away_score||'-'||home_score as score, period_clock,
       margin, case when margin is null then '-'
                    when margin > 0 then 'COVERING'
                    when margin < 0 then 'losing'
                    else 'push' end as state
from live_picks where home_score is not null order by player;

\echo ''
\echo '=== TEST 7: payout formula still reproduces the spreadsheet ==='
create temp table hist(season text, nm text, w int, l int, expected numeric);
insert into hist values
 ('22-23','Luke',11,17,-140),('22-23','Ryan',14,14,160),('22-23','Mark',13,16,10),
 ('22-23','Steve',13,15,60),('22-23','Scott',12,17,-90),
 ('23-24','Luke',15,13,180),('23-24','Ryan',9,19,-420),('23-24','Mark',11,18,-270),
 ('23-24','Steve',18,11,430),('23-24','Scott',14,14,80),
 ('24-25','Luke',13,20,-270),('24-25','Ryan',17,16,130),('24-25','Mark',15,17,-20),
 ('24-25','Steve',16,17,30),('24-25','Scott',17,16,130),
 ('25-26','Nick',16,18,160),('25-26','Ryan',11,23,-340),('25-26','Mark',13,20,-90),
 ('25-26','Steve',18,16,360),('25-26','Scott',13,20,-90);
insert into seasons (label, stake_usd) select distinct season,10 from hist;
insert into season_players (season_id, player_id, base_order)
select s.id,p.id,row_number() over (partition by h.season order by h.nm)
from hist h join seasons s on s.label=h.season join players p on p.name=h.nm;
insert into periods (season_id, seq, label, status)
select s.id,1,'all','final' from seasons s where s.label in (select distinct season from hist);
insert into games (period_id, external_id, home_team, away_team, kickoff)
select pe.id,'g'||g,'H'||g,'A'||g, now()
from periods pe join seasons s on s.id=pe.season_id, generate_series(1,400) g
where s.label in (select distinct season from hist);
with expanded as (
  select h.season,h.nm,'win'::text res, generate_series(1,h.w) i from hist h where h.w>0
  union all select h.season,h.nm,'loss', generate_series(1,h.l) from hist h where h.l>0),
numbered as (select e.*, row_number() over (partition by e.season order by e.nm,e.res,e.i) rn from expanded e)
insert into picks (period_id, player_id, game_id, market, side, line, pick_number, result)
select pe.id,p.id,g.id,'spread','home',-3,n.rn,n.res
from numbered n join seasons s on s.label=n.season join periods pe on pe.season_id=s.id
join players p on p.name=n.nm join games g on g.period_id=pe.id and g.external_id='g'||n.rn;

select case when count(*) filter (where po.net_usd <> h.expected)=0
       then 'ALL '||count(*)||' HISTORICAL PAYOUTS STILL EXACT'
       else count(*) filter (where po.net_usd <> h.expected)||' MISMATCHES' end as verdict
from payouts po join hist h on h.season=po.season and h.nm=po.name;

\echo ''
\echo '=== TEST 8: scoreboard grid, spreadsheet-style ==='
select period, name, w, l from weekly_grid
where season_id=(select id from seasons where label='24-25') order by name;

\echo ''
\echo '=== TEST 9: weekend_preview_locks grades a Lock of the Week correctly ==='
-- Exercises every branch of the case expression: call matches result (both
-- directions), call misses, a push, and a still-ungraded pick. Uses real
-- picks already sitting in the fixture above (period 'all', from TEST 7),
-- not new data, so this never depends on the current live season's state.
do $$
declare
  p_win_pick  uuid;
  p_loss_pick uuid;
  p_period    uuid;
begin
  select id, period_id into p_win_pick, p_period from picks where result = 'win' limit 1;
  select id into p_loss_pick from picks where result = 'loss' and period_id = p_period limit 1;

  insert into weekend_previews (period_id, intro, players, lock_pick_id, lock_call, lock_blurb)
  values (p_period, 'test', '[]'::jsonb, p_win_pick, 'win', 'win-pick, called win -> should be CORRECT')
  on conflict (period_id) do update set lock_pick_id = excluded.lock_pick_id,
    lock_call = excluded.lock_call, lock_blurb = excluded.lock_blurb;
end $$;

select 'win pick, call=win (expect t)' as case, call_correct
from weekend_preview_locks where lock_blurb like 'win-pick%';

update weekend_previews wp set lock_call = 'lose', lock_blurb = 'win-pick, called lose -> should be WRONG'
from picks pk where wp.lock_pick_id = pk.id and pk.result = 'win' and wp.intro = 'test';
select 'win pick, call=lose (expect f)' as case, call_correct
from weekend_preview_locks where lock_blurb like 'win-pick%';

update weekend_previews set lock_pick_id = (select id from picks where result = 'loss' limit 1),
       lock_call = 'lose', lock_blurb = 'loss-pick, called lose -> should be CORRECT'
where intro = 'test';
select 'loss pick, call=lose (expect t)' as case, call_correct
from weekend_preview_locks where lock_blurb like 'loss-pick%';

update weekend_previews set lock_pick_id = (select id from picks where result is null limit 1),
       lock_call = 'win', lock_blurb = 'ungraded pick -> should be PENDING (null)'
where intro = 'test';
select 'ungraded pick (expect null)' as case, call_correct
from weekend_preview_locks where lock_blurb like 'ungraded%';

-- Pushes are voided everywhere else in this app; the Lock should agree.
update picks set result = 'push' where id = (select id from picks where result = 'win' limit 1);
update weekend_previews set lock_pick_id = (select id from picks where result = 'push' limit 1),
       lock_call = 'win', lock_blurb = 'push pick -> should be PENDING (null)'
where intro = 'test';
select 'push pick (expect null)' as case, call_correct
from weekend_preview_locks where lock_blurb like 'push pick%';
update picks set result = 'win' where result = 'push';

delete from weekend_previews where intro = 'test';
