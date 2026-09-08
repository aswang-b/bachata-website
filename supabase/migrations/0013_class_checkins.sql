-- Run this in the Supabase SQL editor after 0001-0012.

create table if not exists class_checkins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  class_title text not null,
  event_id uuid references events(id)
);
