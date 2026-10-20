-- Run this in the Supabase SQL editor after 0001-0044. Safe to re-run, and
-- nothing in the app changes when it runs.
--
-- Supabase stops granting new public tables to the Data API roles
-- automatically (github.com/orgs/supabase/discussions/45329; all existing
-- projects from Oct 30, 2026). Existing tables keep their grants, but a new
-- table, or this database rebuilt from these migrations, would get none, and
-- the server's queries would fail with "permission denied" (42501).
--
-- This site only reaches its tables from the server, with the service-role
-- key (the browser uses the anon key just to sign admins in). So:
-- 1. Grant every table to service_role explicitly.
-- 2. Take the table grants away from anon and authenticated, which never
--    needed them (RLS with no policies already kept them from every row).
-- 3. Switch this project to the new default now, so a future migration that
--    forgets its grant fails right away instead of after the cutover. Every
--    migration that creates a table must grant it to service_role (enforced
--    by tests/unit/codebaseRules.test.ts).

do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_google_tokens', 'api_usage_daily', 'attendance_matches', 'attendance_no_shows',
    'class_checkins', 'class_registrations', 'community_guidelines', 'deletion_audit',
    'edit_locks', 'event_spot_counts', 'events', 'faqs', 'homepage_content',
    'intake_submissions', 'notification_settings', 'site_banner', 'site_settings'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;
