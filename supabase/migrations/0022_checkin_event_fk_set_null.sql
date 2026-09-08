-- Run this in the Supabase SQL editor after 0001-0021.
--
-- class_checkins.event_id previously blocked deleting an event (or a whole
-- series) once anyone had checked into it — the FK had no ON DELETE rule, so
-- it defaulted to RESTRICT. class_checkins.class_title already stores a text
-- snapshot of the class name independent of event_id (see submit-checkin.ts
-- and edit-checkin.ts), so it's safe for a check-in to simply lose its event
-- link when the class itself is deleted, rather than blocking the delete.

alter table class_checkins drop constraint if exists class_checkins_event_id_fkey;
alter table class_checkins
  add constraint class_checkins_event_id_fkey
  foreign key (event_id) references events(id) on delete set null;
