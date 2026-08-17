-- Run after schema.sql. Safe to run twice.
-- Small key/value table so the app can remember things between requests --
-- currently how many Odds API credits are left this month.
create table if not exists app_state (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
