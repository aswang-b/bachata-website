-- Run this in the Supabase SQL editor after 0001_init.sql.

alter table events add column if not exists color text not null default 'accent';

-- Replace the generic placeholder rows from 0001 with the real class series.
delete from events where title in ('Beginner Bachata', 'Intermediate Bachata');

-- Beginner Bachata: 4-week series, Sundays 9/20-10/11, 1-2pm CT (CDT, UTC-5), shown in green.
insert into events (title, description, event_type, color, start_time, end_time)
values
  ('Beginner Bachata', 'Week 1 of 4', 'class', 'green', '2026-09-20 13:00:00-05', '2026-09-20 14:00:00-05'),
  ('Beginner Bachata', 'Week 2 of 4', 'class', 'green', '2026-09-27 13:00:00-05', '2026-09-27 14:00:00-05'),
  ('Beginner Bachata', 'Week 3 of 4', 'class', 'green', '2026-10-04 13:00:00-05', '2026-10-04 14:00:00-05'),
  ('Beginner Bachata', 'Week 4 of 4', 'class', 'green', '2026-10-11 13:00:00-05', '2026-10-11 14:00:00-05');

-- Intermediate Bachata: same 4 Sundays, 2-3pm CT.
insert into events (title, description, event_type, color, start_time, end_time)
values
  ('Intermediate Bachata', 'Week 1 of 4', 'class', 'accent', '2026-09-20 14:00:00-05', '2026-09-20 15:00:00-05'),
  ('Intermediate Bachata', 'Week 2 of 4', 'class', 'accent', '2026-09-27 14:00:00-05', '2026-09-27 15:00:00-05'),
  ('Intermediate Bachata', 'Week 3 of 4', 'class', 'accent', '2026-10-04 14:00:00-05', '2026-10-04 15:00:00-05'),
  ('Intermediate Bachata', 'Week 4 of 4', 'class', 'accent', '2026-10-11 14:00:00-05', '2026-10-11 15:00:00-05');
