-- Run this in the Supabase SQL editor after 0001-0033.
-- Per-IP daily cap on Contact Me admin notification emails, editable from
-- /admin (Admin tab). Only the notification email is skipped once an IP is
-- over the cap — the submission itself is always saved and shows in the inbox.

alter table notification_settings
  add column if not exists contact_email_per_ip_daily_cap integer not null default 3
  check (contact_email_per_ip_daily_cap between 1 and 100);
