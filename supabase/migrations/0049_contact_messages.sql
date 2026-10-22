-- Run this in the Supabase SQL editor after 0001-0048, BEFORE deploying the
-- code that saves Contact form messages here, and then ONCE MORE right after
-- that deploy (it's safe to re-run) to move any message sent in between.
--
-- Contact form messages get their own table instead of living among the
-- class/event sign-ups in intake_submissions (as registration_type
-- 'private'), where they showed up on the dashboard as a sign-up with no
-- class. It holds what the Contact form asks for.

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  instagram text,
  whatsapp text,
  message text,
  -- Opening the admin inbox marks messages seen (drives its unread dot).
  seen boolean not null default false,
  -- Only set on a message that was already in the Recycling Bin when it was moved here.
  deleted_at timestamptz
);

create index if not exists contact_messages_created_at_idx on contact_messages (created_at desc);

-- Server only (see 0045).
alter table contact_messages enable row level security;
revoke all on table contact_messages from anon, authenticated;
grant select, insert, update, delete on table contact_messages to service_role;

-- Move the existing ones, keeping their ids (so old confirmation links still
-- work), then take them out of intake_submissions. Contact messages never
-- have class registrations; only rows that made it into contact_messages are
-- removed, so nothing is lost if this stops partway.
insert into contact_messages (id, created_at, first_name, last_name, email, phone, instagram, whatsapp, message, seen, deleted_at)
select id, created_at, coalesce(first_name, ''), coalesce(last_name, ''), email, phone, instagram, whatsapp, comments, coalesce(seen, false), deleted_at
from intake_submissions
where registration_type = 'private'
on conflict (id) do nothing;

delete from intake_submissions s
where s.registration_type = 'private'
  and exists (select 1 from contact_messages c where c.id = s.id)
  and not exists (select 1 from class_registrations r where r.submission_id = s.id);
