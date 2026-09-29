-- Run this in the Supabase SQL editor after 0001-0034.
-- Per-IP daily cap on class check-ins, editable from /admin (Admin tab) —
-- replaces the CHECKIN_DAILY_CAP_PER_IP env var. Each class checked into
-- counts once. Until this runs, the app falls back to the old default (300).

alter table notification_settings
  add column if not exists checkin_per_ip_daily_cap integer not null default 300
  check (checkin_per_ip_daily_cap between 1 and 5000);
