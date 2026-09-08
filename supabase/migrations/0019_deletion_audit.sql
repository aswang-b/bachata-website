-- Run this in the Supabase SQL editor after 0001-0018.
--
-- Audit trail for deletions in admin/analytics, so an accidental delete can
-- be reviewed and restored. Self-pruning: the app deletes rows older than 7
-- days whenever it writes a new one, so this never needs a cron job and
-- never grows unbounded.

create table if not exists deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_at timestamptz not null default now(),
  deleted_by text,
  table_name text not null,
  action text not null,
  record_id uuid not null,
  dancer_index int,
  snapshot jsonb not null
);

create index if not exists deletion_audit_deleted_at_idx on deletion_audit (deleted_at desc);

alter table deletion_audit enable row level security;
-- No policies: only the service-role key (server-side only) can read/write this table.
