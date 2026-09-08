-- Run this in the Supabase SQL editor after 0001-0019.

alter table intake_submissions add column if not exists whatsapp text;
