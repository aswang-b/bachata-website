-- Run this in the Supabase SQL editor after 0001-0008.

alter table events add column if not exists location text;
