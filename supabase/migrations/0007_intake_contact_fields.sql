-- Run this in the Supabase SQL editor after 0001-0006.

alter table intake_submissions add column if not exists instagram text;
alter table intake_submissions add column if not exists preferred_contact_method text;
