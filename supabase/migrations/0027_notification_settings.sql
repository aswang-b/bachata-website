-- Run this in the Supabase SQL editor after 0001-0026.
-- Singleton row holding the admin notification recipient list (Contact Me
-- form emails), so it can be edited from /admin instead of a Netlify env var.
-- Seeded with the current NOTIFICATION_EMAILS value so nothing changes until
-- an admin edits it.

create table if not exists notification_settings (
  id boolean primary key default true check (id),
  recipient_emails text not null default '',
  updated_at timestamptz not null default now()
);

insert into notification_settings (id, recipient_emails) values (
  true,
  'alex.x.y.wang@gmail.com'
) on conflict (id) do nothing;

alter table notification_settings enable row level security;
