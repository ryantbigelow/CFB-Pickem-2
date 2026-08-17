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
insert into periods (season_id, seq, label, picks_per_player, status)
select s.id, v.seq, v.label, v.ppp, v.st
from seasons s, (values
  (1,'Wk 0-1',2,'open'),
  (2,'Wk 2',2,'upcoming'),   (3,'Wk 3',2,'upcoming'),
  (4,'Wk 4',2,'upcoming'),   (5,'Wk 5',2,'upcoming'),
  (6,'Wk 6',2,'upcoming'),   (7,'Wk 7',2,'upcoming'),
  (8,'Wk 8',2,'upcoming'),   (9,'Wk 9',2,'upcoming'),
  (10,'Wk 10',2,'upcoming'), (11,'Wk 11',2,'upcoming'),
  (12,'Wk 12',2,'upcoming'), (13,'Wk 13',2,'upcoming'),
  (14,'Wk 14',2,'upcoming'),
  (15,'Chmp',1,'upcoming'),  (16,'Bowl 1',1,'upcoming'),
  (17,'Bowl 2',2,'upcoming'),(18,'CFB',2,'upcoming')
) v(seq,label,ppp,st)
where s.label = '26-27'
on conflict (season_id, seq) do nothing;
