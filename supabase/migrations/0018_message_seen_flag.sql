-- Run this in the Supabase SQL editor after 0001-0017.

alter table intake_submissions add column if not exists seen boolean not null default false;
