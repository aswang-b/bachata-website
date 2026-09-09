-- Run this in the Supabase SQL editor after 0001-0027.
-- One row per (dancer, class) registered on a submission, so the admin
-- Sign-Ups table can show a true combo breakdown instead of parsing the
-- semicolon-joined `intake_submissions.class` string at render time.
-- `intake_submissions` itself is untouched — it stays the source of truth
-- for the original form submission, confirmation pages, and the Contact
-- notification email.

create table if not exists class_registrations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references intake_submissions(id) on delete cascade,
  dancer_index int,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  class_title text not null,
  class_label text not null,
  series_mode text check (series_mode in ('whole', 'dropin')),
  price numeric,
  created_at timestamptz not null default now()
);

create index if not exists class_registrations_submission_id_idx on class_registrations (submission_id);

alter table class_registrations enable row level security;
