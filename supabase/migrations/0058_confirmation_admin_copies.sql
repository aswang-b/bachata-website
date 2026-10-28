-- Run this in the Supabase SQL editor after 0001-0057, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- The admins' copy of a registration confirmation waits until Resend reports
-- how the dancers' emails went (its webhook: email.delivered / email.bounced),
-- so it can say which ones bounced. One row per sign-up: the Resend ids of the
-- dancers' emails and each one's outcome. The copy goes out once every email
-- has one, or after 20 minutes from the 15-minute scheduled job if Resend
-- never reports.

create table if not exists confirmation_admin_copies (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null,
  email_ids text[] not null,
  -- { "<resend email id>": { "status": "delivered" | "bounced" | "failed", "email": "...", "reason": "..." } }
  outcomes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists confirmation_admin_copies_pending on confirmation_admin_copies using gin (email_ids) where sent_at is null;

-- Records one email's outcome. Returns the row (claimed: sent_at set) when
-- this was the last outcome it was waiting for, so exactly one caller sends
-- the copy; nothing otherwise.
create or replace function record_confirmation_outcome(p_email_id text, p_outcome jsonb)
returns setof confirmation_admin_copies
language plpgsql as $$
declare
  v_row confirmation_admin_copies;
begin
  update confirmation_admin_copies
  set outcomes = outcomes || jsonb_build_object(p_email_id, p_outcome)
  where email_ids @> array[p_email_id] and sent_at is null
  returning * into v_row;
  if not found then
    return;
  end if;
  if (select bool_and(v_row.outcomes ? e) from unnest(v_row.email_ids) as e) then
    return query
      update confirmation_admin_copies set sent_at = now()
      where id = v_row.id and sent_at is null
      returning *;
  end if;
end;
$$;

-- Claims the copies still waiting after p_minutes (Resend never reported).
create or replace function claim_stale_confirmation_copies(p_minutes int)
returns setof confirmation_admin_copies
language sql as $$
  update confirmation_admin_copies set sent_at = now()
  where sent_at is null and created_at < now() - make_interval(mins => p_minutes)
  returning *;
$$;

-- Server only (see 0045).
alter table confirmation_admin_copies enable row level security;
revoke all on table confirmation_admin_copies from anon, authenticated;
grant select, insert, update, delete on table confirmation_admin_copies to service_role;
revoke all on function record_confirmation_outcome(text, jsonb) from public, anon, authenticated;
grant execute on function record_confirmation_outcome(text, jsonb) to service_role;
revoke all on function claim_stale_confirmation_copies(int) from public, anon, authenticated;
grant execute on function claim_stale_confirmation_copies(int) to service_role;
