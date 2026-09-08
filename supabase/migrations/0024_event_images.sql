-- Run this in the Supabase SQL editor after 0001-0023.

alter table events add column if not exists image_url text;

-- Public bucket: uploaded thumbnails need to be viewable by anyone visiting
-- the homepage. Writes only ever happen server-side with the service-role
-- key (see /api/admin/upload-event-image), which bypasses storage RLS
-- regardless of bucket policy, matching the rest of this project's "RLS on,
-- no policies, service role only" lockdown pattern.
insert into storage.buckets (id, name, public)
values ('event-images', 'event-images', true)
on conflict (id) do nothing;
