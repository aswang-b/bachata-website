-- Run this in the Supabase SQL editor after 0001-0009.

create table if not exists site_settings (
  key text primary key,
  enabled boolean not null default false
);

insert into site_settings (key, enabled) values
  ('hide_about_nav', false),
  ('hide_contact_nav', false),
  ('hide_private_panel', false)
on conflict (key) do nothing;
