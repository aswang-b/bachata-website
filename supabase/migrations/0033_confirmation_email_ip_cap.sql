-- Run this in the Supabase SQL editor after 0001-0032.
-- Per-IP daily cap on registration confirmation emails, editable from /admin
-- (Admin tab). Only the confirmation email is skipped once an IP is over the
-- cap — the registration itself is always saved.

alter table notification_settings
  add column if not exists confirmation_email_per_ip_daily_cap integer not null default 50
  check (confirmation_email_per_ip_daily_cap between 1 and 1000);
