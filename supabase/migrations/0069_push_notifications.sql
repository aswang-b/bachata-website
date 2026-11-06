-- Run this in the Supabase SQL editor after 0001-0068, BEFORE deploying the
-- code that sends push notifications. Safe to re-run.
--
-- Push notifications: phones that turned them on from the header bell
-- (components/InstallApp.astro), and what admins sent from
-- /admin/notifications. A subscription belongs to a phone, not a person:
-- nothing here says who the dancer is.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The push service's address for this phone (Google, Apple, Mozilla, Microsoft).
  endpoint text not null unique,
  -- The phone's keys that each message is encrypted with.
  p256dh text not null,
  auth text not null,
  -- 'ios', 'android' or 'other', for the subscriber count.
  platform text not null default 'other' check (platform in ('ios', 'android', 'other')),
  last_sent_at timestamptz
);

create table if not exists push_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sent_by text,
  title text not null,
  body text not null,
  -- A page on this site that the notification opens.
  url text not null,
  -- The class or event it's about, if any. No foreign key: the history stays
  -- when the event is later deleted.
  event_id uuid,
  delivered integer not null default 0,
  failed integer not null default 0,
  -- Phones that turned out to be gone, and were removed.
  removed integer not null default 0
);

create index if not exists push_sends_created_at_idx on push_sends (created_at desc);
create index if not exists push_sends_event_idx on push_sends (event_id);

alter table push_subscriptions enable row level security;
alter table push_sends enable row level security;
revoke all on table push_subscriptions from anon, authenticated;
revoke all on table push_sends from anon, authenticated;
grant select, insert, update, delete on table push_subscriptions to service_role;
grant select, insert, update, delete on table push_sends to service_role;
