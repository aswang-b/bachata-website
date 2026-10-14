-- Run this in the Supabase SQL editor after 0001-0039, BEFORE deploying the
-- code that calls these functions (the dancer dashboard's deletes, edits,
-- restores, and Empty Recycling Bin all go through them).
--
-- A group sign-up's dancers live inside intake_submissions.dancers, so
-- deleting, restoring, or editing one dancer, and emptying the bin, used to
-- read that list, change it in the app, and write the whole list back in
-- separate calls. Two admins on different dashboard tabs could then overwrite
-- each other's change, and a failure halfway through emptying the bin could
-- leave class registrations pointing at the wrong dancer. Each function below
-- locks the sign-up row and does its whole change in one transaction.
--
-- All class_registrations changes are plain row updates/deletes, so 0039's
-- spot-count trigger still recounts every series they touch.

-- Every caller is the server (service role); the public anon key must never
-- be able to delete or restore anything.
--
-- Errors use SQLSTATE P0002 (no_data_found) for "not found" so the app can
-- answer 404; anything else is a 500.

create or replace function bin_mark_dancer(p_dancer jsonb, p_at timestamptz, p_by text, p_deletion_id uuid)
returns jsonb
language sql stable
as $$
  select p_dancer || jsonb_build_object(
    'deleted', true,
    'deletedAt', to_char(p_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedBy', p_by,
    'deletionId', p_deletion_id::text
  );
$$;

-- Deletes one dancer of a sign-up, or the whole sign-up when that dancer is
-- its only (remaining) one. p_dancer_index null means a single-registrant
-- sign-up.
create or replace function soft_delete_dancer(p_submission_id uuid, p_dancer_index int, p_deleted_by text)
returns void
language plpgsql
as $$
declare
  v_dancers jsonb;
  v_live int;
  v_at timestamptz := now();
  v_deletion_id uuid := gen_random_uuid();
begin
  select dancers into v_dancers
  from intake_submissions
  where id = p_submission_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Sign-up not found.' using errcode = 'P0002';
  end if;

  if jsonb_typeof(v_dancers) = 'array' then
    select count(*) into v_live from jsonb_array_elements(v_dancers) d where not coalesce((d ->> 'deleted')::boolean, false);
  else
    v_live := 0;
  end if;

  if p_dancer_index is null or jsonb_typeof(v_dancers) is distinct from 'array' or v_live <= 1 then
    update intake_submissions
    set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
    where id = p_submission_id;
    update class_registrations
    set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
    where submission_id = p_submission_id and deleted_at is null;
    return;
  end if;

  if p_dancer_index < 0 or p_dancer_index >= jsonb_array_length(v_dancers)
     or coalesce((v_dancers -> p_dancer_index ->> 'deleted')::boolean, false) then
    raise exception 'Dancer not found.' using errcode = 'P0002';
  end if;

  update intake_submissions
  set dancers = jsonb_set(v_dancers, array[p_dancer_index::text], bin_mark_dancer(v_dancers -> p_dancer_index, v_at, p_deleted_by, v_deletion_id))
  where id = p_submission_id;
  update class_registrations
  set deleted_at = v_at, deleted_by = p_deleted_by, deletion_id = v_deletion_id
  where submission_id = p_submission_id and dancer_index = p_dancer_index and deleted_at is null;
end;
$$;

-- Deletes one class registration (e.g. an orphaned sign-up from the
-- attendance workqueue). If it's the dancer's last remaining class, the
-- dancer (or the whole single-dancer sign-up) goes with it, so the Sign-Ups
-- tab is never left with a class-less row.
create or replace function soft_delete_registration(p_registration_id uuid, p_deleted_by text)
returns void
language plpgsql
as $$
declare
  v_reg record;
  v_siblings int;
begin
  select submission_id, dancer_index into v_reg
  from class_registrations
  where id = p_registration_id and deleted_at is null;
  if not found then
    raise exception 'Sign-up not found.' using errcode = 'P0002';
  end if;

  -- Lock the sign-up first so the sibling count can't change under us.
  perform 1 from intake_submissions where id = v_reg.submission_id for update;

  select count(*) into v_siblings
  from class_registrations
  where submission_id = v_reg.submission_id
    and id <> p_registration_id
    and deleted_at is null
    and dancer_index is not distinct from v_reg.dancer_index;

  if v_siblings = 0 then
    perform soft_delete_dancer(v_reg.submission_id, v_reg.dancer_index, p_deleted_by);
    return;
  end if;

  update class_registrations
  set deleted_at = now(), deleted_by = p_deleted_by, deletion_id = gen_random_uuid()
  where id = p_registration_id and deleted_at is null;
  if not found then
    raise exception 'Sign-up not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Clears the flag from every row (and group-sign-up dancer) one delete marked.
create or replace function restore_deletion(p_deletion_id uuid)
returns void
language plpgsql
as $$
begin
  update intake_submissions set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;
  update class_registrations set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;
  update class_checkins set deleted_at = null, deleted_by = null, deletion_id = null where deletion_id = p_deletion_id;

  -- One statement, so each sign-up row is locked and re-read before its
  -- dancers list is rewritten.
  update intake_submissions s
  set dancers = (
    select jsonb_agg(
      case when d ->> 'deletionId' = p_deletion_id::text then d - 'deleted' - 'deletedAt' - 'deletedBy' - 'deletionId' else d end
      order by ord
    )
    from jsonb_array_elements(s.dancers) with ordinality t(d, ord)
  )
  where s.dancers @> jsonb_build_array(jsonb_build_object('deletionId', p_deletion_id::text));
end;
$$;

-- Saves an admin's edit of one dancer's details (or a single-registrant
-- sign-up's) plus the sign-up's payment fields, changing only that dancer's
-- entry so a concurrent delete of another dancer is never overwritten.
-- p_dancer holds firstName/lastName/email/phone.
create or replace function update_signup_dancer(
  p_submission_id uuid,
  p_dancer_index int,
  p_dancer jsonb,
  p_payment_method text,
  p_paid boolean
)
returns void
language plpgsql
as $$
declare
  v_dancers jsonb;
begin
  select dancers into v_dancers
  from intake_submissions
  where id = p_submission_id and deleted_at is null
  for update;
  if not found then
    raise exception 'Sign-up not found.' using errcode = 'P0002';
  end if;

  if p_dancer_index is not null then
    if jsonb_typeof(v_dancers) is distinct from 'array'
       or p_dancer_index < 0 or p_dancer_index >= jsonb_array_length(v_dancers)
       or coalesce((v_dancers -> p_dancer_index ->> 'deleted')::boolean, false) then
      raise exception 'Dancer not found.' using errcode = 'P0002';
    end if;
    update intake_submissions
    set dancers = jsonb_set(v_dancers, array[p_dancer_index::text], (v_dancers -> p_dancer_index) || p_dancer)
    where id = p_submission_id;
  end if;

  -- The sign-up's own name/contact columns mirror its first dancer.
  update intake_submissions
  set payment_method = p_payment_method,
      paid = p_paid,
      first_name = case when coalesce(p_dancer_index, 0) = 0 then coalesce(p_dancer ->> 'firstName', '') else first_name end,
      last_name = case when coalesce(p_dancer_index, 0) = 0 then coalesce(p_dancer ->> 'lastName', '') else last_name end,
      email = case when coalesce(p_dancer_index, 0) = 0 then nullif(p_dancer ->> 'email', '') else email end,
      phone = case when coalesce(p_dancer_index, 0) = 0 then nullif(p_dancer ->> 'phone', '') else phone end
  where id = p_submission_id;
end;
$$;

-- Permanently deletes everything in the bin, all or nothing.
create or replace function empty_recycling_bin()
returns void
language plpgsql
as $$
declare
  s record;
  v_removed int[];
  v_live jsonb;
begin
  delete from class_checkins where deleted_at is not null;

  -- Drop flagged dancers out of live group sign-ups: delete their class
  -- registrations and shift later dancers' registrations down so
  -- dancer_index keeps lining up with the dancers list.
  for s in
    select id, dancers from intake_submissions
    where deleted_at is null and dancers @> '[{"deleted": true}]'
    for update
  loop
    select array_agg((ord - 1)::int) into v_removed
    from jsonb_array_elements(s.dancers) with ordinality t(d, ord)
    where coalesce((d ->> 'deleted')::boolean, false);

    select coalesce(jsonb_agg(d order by ord), '[]'::jsonb) into v_live
    from jsonb_array_elements(s.dancers) with ordinality t(d, ord)
    where not coalesce((d ->> 'deleted')::boolean, false);

    delete from class_registrations where submission_id = s.id and dancer_index = any(v_removed);

    update class_registrations r
    set dancer_index = r.dancer_index - (select count(*) from unnest(v_removed) x where x < r.dancer_index)
    where r.submission_id = s.id
      and r.dancer_index is not null
      and exists (select 1 from unnest(v_removed) x where x < r.dancer_index);

    update intake_submissions
    set dancers = v_live,
        first_name = coalesce(v_live -> 0 ->> 'firstName', ''),
        last_name = coalesce(v_live -> 0 ->> 'lastName', ''),
        email = nullif(v_live -> 0 ->> 'email', ''),
        phone = nullif(v_live -> 0 ->> 'phone', '')
    where id = s.id;
  end loop;

  -- Cascades to the deleted sign-ups' class registrations and attendance links.
  delete from intake_submissions where deleted_at is not null;
  delete from class_registrations where deleted_at is not null;
end;
$$;

revoke all on function bin_mark_dancer(jsonb, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function soft_delete_dancer(uuid, int, text) from public, anon, authenticated;
revoke all on function soft_delete_registration(uuid, text) from public, anon, authenticated;
revoke all on function restore_deletion(uuid) from public, anon, authenticated;
revoke all on function update_signup_dancer(uuid, int, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function empty_recycling_bin() from public, anon, authenticated;
grant execute on function bin_mark_dancer(jsonb, timestamptz, text, uuid) to service_role;
grant execute on function soft_delete_dancer(uuid, int, text) to service_role;
grant execute on function soft_delete_registration(uuid, text) to service_role;
grant execute on function restore_deletion(uuid) to service_role;
grant execute on function update_signup_dancer(uuid, int, jsonb, text, boolean) to service_role;
grant execute on function empty_recycling_bin() to service_role;

-- The bin finds flagged dancers (and a restore finds one delete's dancers)
-- with jsonb containment on dancers; without this every sign-up is scanned.
create index if not exists intake_submissions_dancers_gin on intake_submissions using gin (dancers jsonb_path_ops);
