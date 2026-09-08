-- Run this in the Supabase SQL editor after 0001 and 0002.

-- Links a Supabase event row to the Google Calendar event it's synced with.
alter table events add column if not exists google_event_id text;
alter table events add column if not exists updated_at timestamptz not null default now();

create unique index if not exists events_google_event_id_idx
  on events (google_event_id)
  where google_event_id is not null;

-- Keep updated_at current automatically so the sync can tell which side
-- (site or Google) changed more recently.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists events_set_updated_at on events;
create trigger events_set_updated_at
  before update on events
  for each row execute function set_updated_at();

-- Stores the admin's Google OAuth refresh token so the server can call the
-- Calendar API on a schedule, outside of any browser session. Only ever
-- read/written with the service role key, so RLS with no policies is
-- intentional — it locks the table down from anon/public access entirely.
create table if not exists admin_google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  email text not null,
  refresh_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table admin_google_tokens enable row level security;
