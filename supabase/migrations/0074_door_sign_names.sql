-- Run this in the Supabase SQL editor after 0001-0073, BEFORE deploying the
-- code that saves a door sign's check-in subheading. Safe to re-run.
--
-- Door signs (/admin/qr): each sign's heading is also its name in Saved signs,
-- so no two signs share one (ignoring case and spaces at the ends). And the
-- line over the check-in code ("Check in for class") can be changed per sign.

alter table door_signs add column if not exists checkin_title text not null default 'Check in for class';

-- Signs saved before this with the same heading (or none) are told apart first:
-- the newer ones get " (2)", " (3)", …, and an empty heading becomes "Door sign".
with named as (
  select id, coalesce(nullif(trim(heading), ''), 'Door sign') as base,
         row_number() over (partition by lower(coalesce(nullif(trim(heading), ''), 'Door sign')) order by created_at, id) as n
  from door_signs
)
update door_signs d
set heading = case when named.n = 1 then named.base else named.base || ' (' || named.n || ')' end
from named
where d.id = named.id
  and d.heading is distinct from case when named.n = 1 then named.base else named.base || ' (' || named.n || ')' end;

create unique index if not exists door_signs_heading_idx on door_signs (lower(trim(heading)));
