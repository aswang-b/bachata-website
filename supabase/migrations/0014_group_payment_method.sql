-- Run this in the Supabase SQL editor after 0001-0013.

alter table intake_submissions add column if not exists payment_method text;
