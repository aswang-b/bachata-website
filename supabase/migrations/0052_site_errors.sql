-- Run this in the Supabase SQL editor after 0001-0051, BEFORE deploying the
-- code that logs to it. Safe to re-run.
--
-- The dashboard's Errors workqueue: problems the site hit on its own (a
-- bounced email, a Google API error, an email that failed to send, a sign-up
-- that failed to save), one line each, for an admin to fix or dismiss. A
-- repeat of an error that's still open (same dedupe_key) adds to its count
-- instead of adding a line, so a failing sync doesn't flood the list.

create table if not exists site_errors (
  id uuid primary key default gen_random_uuid(),
  -- 'email_bounce', 'google_api', 'google_auth', 'email_send', 'signup_save', ...
  kind text not null,
  message text not null,
  -- Whatever the error's actions need, e.g. { "email": "..." } for a bounce.
  details jsonb not null default '{}',
  dedupe_key text,
  count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  closed_at timestamptz,
  closed_by text
);

create unique index if not exists site_errors_open_dedupe_idx on site_errors (dedupe_key) where status = 'open';
create index if not exists site_errors_open_idx on site_errors (last_seen_at desc) where status = 'open';

-- Adds an error, or counts a repeat of the same one that's still open.
create or replace function log_site_error(p_kind text, p_message text, p_details jsonb, p_dedupe_key text)
returns uuid
language plpgsql as $$
declare
  v_id uuid;
begin
  if p_dedupe_key is not null then
    update site_errors
    set count = count + 1, last_seen_at = now(), message = p_message, details = coalesce(p_details, details)
    where dedupe_key = p_dedupe_key and status = 'open'
    returning id into v_id;
    if found then
      return v_id;
    end if;
  end if;
  insert into site_errors (kind, message, details, dedupe_key)
  values (p_kind, p_message, coalesce(p_details, '{}'), p_dedupe_key)
  on conflict (dedupe_key) where status = 'open'
  do update set count = site_errors.count + 1, last_seen_at = now(), message = excluded.message
  returning id into v_id;
  return v_id;
end;
$$;

-- Server only (see 0045).
alter table site_errors enable row level security;
revoke all on table site_errors from anon, authenticated;
grant select, insert, update, delete on table site_errors to service_role;
revoke all on function log_site_error(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function log_site_error(text, text, jsonb, text) to service_role;
