-- Run this in the Supabase SQL editor after 0001-0053, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Contact messages an admin has replied to: marked in the inbox, they move to
-- its "Replied messages" archive (which only loads when opened).

alter table contact_messages add column if not exists replied_at timestamptz;
alter table contact_messages add column if not exists replied_by text;

-- The inbox loads the ones not yet replied to, newest first.
create index if not exists contact_messages_unreplied_idx on contact_messages (created_at desc) where replied_at is null and deleted_at is null;
