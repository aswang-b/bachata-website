-- Run this in the Supabase SQL editor after 0001-0058, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Hardens the admins' confirmation copy (0058):
--  * Resend's report on a dancer's email is kept even when it arrives before
--    the copy is queued (a fast bounce), and merged in when it is.
--  * A copy whose send fails goes back in the queue; the 15-minute job tries
--    it up to 3 times.
--  * The functions run with a fixed search_path.

-- Every delivered/bounced report, by Resend email id; pruned after 2 days.
create table if not exists confirmation_email_outcomes (
  email_id text primary key,
  outcome jsonb not null,
  created_at timestamptz not null default now()
);

alter table confirmation_admin_copies add column if not exists attempts int not null default 0;

-- Records one email's outcome. Returns the copies it completed (claimed:
-- sent_at set), so exactly one caller sends each.
create or replace function record_confirmation_outcome(p_email_id text, p_outcome jsonb)
returns setof confirmation_admin_copies
language plpgsql
set search_path = public
as $$
begin
  insert into confirmation_email_outcomes (email_id, outcome) values (p_email_id, p_outcome)
  on conflict (email_id) do update set outcome = excluded.outcome;
  update confirmation_admin_copies
  set outcomes = outcomes || jsonb_build_object(p_email_id, p_outcome)
  where email_ids @> array[p_email_id] and sent_at is null;
  return query
    update confirmation_admin_copies c set sent_at = now()
    where c.email_ids @> array[p_email_id] and c.sent_at is null
      and not exists (select 1 from unnest(c.email_ids) as e where not (c.outcomes ? e))
    returning c.*;
end;
$$;

-- Queues a sign-up's copy with any outcomes already reported. Returns it
-- (claimed) when nothing is left to wait for.
create or replace function queue_confirmation_copy(p_submission_id uuid, p_email_ids text[], p_outcomes jsonb)
returns setof confirmation_admin_copies
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into confirmation_admin_copies (submission_id, email_ids, outcomes)
  values (
    p_submission_id,
    p_email_ids,
    p_outcomes || coalesce((select jsonb_object_agg(o.email_id, o.outcome) from confirmation_email_outcomes o where o.email_id = any(p_email_ids)), '{}')
  )
  returning id into v_id;
  return query
    update confirmation_admin_copies c set sent_at = now()
    where c.id = v_id and c.sent_at is null
      and not exists (select 1 from unnest(c.email_ids) as e where not (c.outcomes ? e))
    returning c.*;
end;
$$;

-- Claims the copies still waiting after p_minutes (Resend never reported, or
-- a send failed), with whatever outcomes are known; at most 3 tries each.
create or replace function claim_stale_confirmation_copies(p_minutes int)
returns setof confirmation_admin_copies
language plpgsql
set search_path = public
as $$
begin
  delete from confirmation_email_outcomes where created_at < now() - interval '2 days';
  return query
    update confirmation_admin_copies c
    set sent_at = now(),
        attempts = c.attempts + 1,
        outcomes = c.outcomes || coalesce((select jsonb_object_agg(o.email_id, o.outcome) from confirmation_email_outcomes o where o.email_id = any(c.email_ids)), '{}')
    where c.sent_at is null and c.attempts < 3 and c.created_at < now() - make_interval(mins => p_minutes)
    returning c.*;
end;
$$;

-- Server only (see 0045).
alter table confirmation_email_outcomes enable row level security;
revoke all on table confirmation_email_outcomes from anon, authenticated;
grant select, insert, update, delete on table confirmation_email_outcomes to service_role;
revoke all on function record_confirmation_outcome(text, jsonb) from public, anon, authenticated;
grant execute on function record_confirmation_outcome(text, jsonb) to service_role;
revoke all on function queue_confirmation_copy(uuid, text[], jsonb) from public, anon, authenticated;
grant execute on function queue_confirmation_copy(uuid, text[], jsonb) to service_role;
revoke all on function claim_stale_confirmation_copies(int) from public, anon, authenticated;
grant execute on function claim_stale_confirmation_copies(int) to service_role;
