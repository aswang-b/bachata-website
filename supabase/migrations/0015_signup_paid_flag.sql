-- Run this in the Supabase SQL editor after 0001-0014.

alter table intake_submissions add column if not exists paid boolean not null default false;
