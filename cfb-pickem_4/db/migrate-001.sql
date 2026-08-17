-- Run this ONLY if you already ran schema.sql before Aug 17.
-- Safe to run twice; does nothing if the column is already there.
alter table games add column if not exists scores_updated timestamptz;
