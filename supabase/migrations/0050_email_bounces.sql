-- Run this in the Supabase SQL editor after 0001-0049, BEFORE deploying the
-- code that records bounces. Safe to re-run.
--
-- Email addresses a confirmation (or any site email) bounced from, as Resend
-- reports them to /api/resend-webhook, so the dashboard can flag a sign-up
-- whose address doesn't work (often a typo) and the admin can reach that
-- person another way. One row per address, with its latest bounce.

create table if not exists email_bounces (
  email text primary key,
  bounced_at timestamptz not null default now(),
  -- Resend's bounce type and message, e.g. 'Permanent' / 'The recipient's mailbox does not exist'.
  bounce_type text,
  reason text
);

-- Server only (see 0045).
alter table email_bounces enable row level security;
revoke all on table email_bounces from anon, authenticated;
grant select, insert, update, delete on table email_bounces to service_role;
