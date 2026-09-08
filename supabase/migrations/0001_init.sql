-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).

create extension if not exists "pgcrypto";

create table if not exists intake_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  registration_type text not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  class text,
  comments text
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_type text not null default 'class',
  start_time timestamptz not null,
  end_time timestamptz
);

-- Seed a few sample classes/events for the calendar placeholder.
insert into events (title, description, event_type, start_time, end_time)
values
  ('Beginner Bachata', 'Weekly group class for new students.', 'class', now() + interval '2 days' + time '19:00', now() + interval '2 days' + time '20:00'),
  ('Intermediate Bachata', 'Weekly group class, footwork & partnerwork.', 'class', now() + interval '4 days' + time '20:00', now() + interval '4 days' + time '21:00'),
  ('Bachata Social Night', 'Open social dancing, all levels welcome.', 'event', now() + interval '9 days' + time '21:00', now() + interval '9 days' + time '23:30'),
  ('Private Lesson Slot', 'Sample private lesson booking block.', 'class', now() + interval '1 day' + time '17:00', now() + interval '1 day' + time '18:00')
on conflict do nothing;

-- Row Level Security: writes/reads happen server-side only via the service
-- role key, which bypasses RLS, so this simply locks the tables down from
-- being read/written directly by anonymous/public clients.
alter table intake_submissions enable row level security;
alter table events enable row level security;
