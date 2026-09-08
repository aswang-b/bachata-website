-- Run this in the Supabase SQL editor after 0001-0015.
-- Singleton row (id is always `true`) holding the site-wide announcement banner.

create table if not exists site_banner (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  content text not null default '',
  updated_at timestamptz not null default now()
);

insert into site_banner (id, enabled, content) values (true, false, '') on conflict (id) do nothing;
