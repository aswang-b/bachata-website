-- Run this in the Supabase SQL editor after 0001-0070, BEFORE deploying the
-- code that saves door signs. Safe to re-run.
--
-- Saved door signs (/admin/qr): what each one shows and the short link on
-- qr.dancewithb.fun its check-in code opens. Each sign has its own link from
-- a pool; deleting a sign frees its link for the next one (lib/doorSigns.ts).

create table if not exists door_signs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  heading text not null default '',
  -- The classes its check-in code opens, in the order picked, and their titles
  -- as saved (shown on the sign even after a class is deleted).
  event_ids text[] not null default '{}',
  titles text[] not null default '{}',
  create_registration boolean not null default false,
  show_classes boolean not null default true,
  -- The Venmo account on it, as { username, name, userId, label }, or null for none.
  venmo jsonb,
  -- Its short link on qr.dancewithb.fun: never shared by two signs.
  link_code text not null,
  link_short text not null,
  -- The check-in address the link was last pointed at.
  pointed_url text
);

create unique index if not exists door_signs_link_code_idx on door_signs (link_code);
create index if not exists door_signs_updated_at_idx on door_signs (updated_at desc);

alter table door_signs enable row level security;
revoke all on table door_signs from anon, authenticated;
grant select, insert, update, delete on table door_signs to service_role;
