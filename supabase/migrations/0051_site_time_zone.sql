-- Run this in the Supabase SQL editor after 0001-0050, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- The site's time zone (admin → General → Site Time Zone): every date and
-- time is shown, grouped into days and entered in it, wherever the server
-- (UTC on Netlify) or the visitor is. One row; starts as Central time, which
-- is what the site assumed until now.

create table if not exists site_config (
  id boolean primary key default true check (id),
  time_zone text not null default 'America/Chicago',
  updated_at timestamptz not null default now()
);

insert into site_config (id) values (true) on conflict (id) do nothing;

-- Server only (see 0045).
alter table site_config enable row level security;
revoke all on table site_config from anon, authenticated;
grant select, insert, update, delete on table site_config to service_role;
