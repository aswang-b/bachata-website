create table if not exists attendance_matches (
  id uuid primary key default gen_random_uuid(),
  class_registration_id uuid not null references class_registrations(id) on delete cascade,
  occurrence_event_id uuid references events(id) on delete set null,
  checkin_id uuid not null references class_checkins(id) on delete cascade,
  matched_by text not null,
  matched_at timestamptz not null default now(),
  unique (checkin_id)
);
create index if not exists attendance_matches_registration_idx on attendance_matches (class_registration_id, occurrence_event_id);

create table if not exists attendance_no_shows (
  id uuid primary key default gen_random_uuid(),
  class_registration_id uuid not null references class_registrations(id) on delete cascade,
  occurrence_event_id uuid references events(id) on delete set null,
  marked_by text not null,
  marked_at timestamptz not null default now()
);
-- coalesce() gives Drop-In rows (occurrence_event_id is null) a stable
-- per-registration uniqueness key, since Postgres otherwise treats every
-- null as distinct and wouldn't enforce "one no-show row per registration".
create unique index if not exists attendance_no_shows_unique_idx on attendance_no_shows (class_registration_id, coalesce(occurrence_event_id, class_registration_id));

alter table attendance_matches enable row level security;
alter table attendance_no_shows enable row level security;
