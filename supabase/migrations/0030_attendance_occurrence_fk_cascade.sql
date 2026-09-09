-- occurrence_event_id previously used ON DELETE SET NULL, which corrupted
-- data: attendanceMatching.ts's entryKey() collapses a null
-- occurrenceEventId to the literal 'single', so once a whole series was
-- deleted, its old attendance_matches/attendance_no_shows rows collided
-- with the key space used by legitimate Drop-In (no-occurrence) entries.
-- A match/no-show tied to a specific occurrence that no longer exists isn't
-- meaningful data to keep around under a different key — it should go away
-- with the occurrence, so this switches both to ON DELETE CASCADE.
alter table attendance_matches drop constraint attendance_matches_occurrence_event_id_fkey;
alter table attendance_matches
  add constraint attendance_matches_occurrence_event_id_fkey
  foreign key (occurrence_event_id) references events(id) on delete cascade;

alter table attendance_no_shows drop constraint attendance_no_shows_occurrence_event_id_fkey;
alter table attendance_no_shows
  add constraint attendance_no_shows_occurrence_event_id_fkey
  foreign key (occurrence_event_id) references events(id) on delete cascade;
