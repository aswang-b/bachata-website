-- Run this in the Supabase SQL editor after 0001-0061, BEFORE deploying the
-- code that counts linked headcount. Safe to re-run.
--
-- Linked classes, take two: an included class is no longer saved as its own
-- $0 sign-up. Instead an "includes" rule can count the including class's
-- sign-ups in the included one's headcount (the Workshop's dancers count
-- toward the Practica's spots), for every class of the two that overlap in
-- time. spot_counts_with_linked is the one place that adds them up: the site
-- shows spots from it and register_submission enforces capacity with it.

alter table event_link_rules add column if not exists count_headcount boolean not null default true;

-- Never used for anything saved by a live site (0061's $0 rows were only
-- ever made by the test suite).
alter table class_registrations drop column if exists included_by;

-- Each event's spots taken, plus those of every class that includes it (with
-- count_headcount) and overlaps it in time.
create or replace function spot_counts_with_linked(p_event_ids uuid[])
returns table (event_id uuid, taken int, leaders_taken int, followers_taken int)
language sql stable as $$
  select
    e.id,
    (coalesce(c.taken, 0) + coalesce(sum(ic.taken), 0))::int,
    (coalesce(c.leaders_taken, 0) + coalesce(sum(ic.leaders_taken), 0))::int,
    (coalesce(c.followers_taken, 0) + coalesce(sum(ic.followers_taken), 0))::int
  from events e
  left join event_spot_counts c on c.event_id = e.id
  left join event_link_rules r
    on r.count_headcount
    and ((r.kind = 'a_includes_b' and r.key_b = coalesce(e.google_recurring_event_id, e.id::text))
      or (r.kind = 'b_includes_a' and r.key_a = coalesce(e.google_recurring_event_id, e.id::text)))
  left join events i
    on coalesce(i.google_recurring_event_id, i.id::text) = case when r.kind = 'a_includes_b' then r.key_a else r.key_b end
    and i.start_time < e.end_time
    and i.end_time > e.start_time
  left join event_spot_counts ic on ic.event_id = i.id
  where e.id = any(p_event_ids)
  group by e.id, c.taken, c.leaders_taken, c.followers_taken;
$$;

revoke all on function spot_counts_with_linked(uuid[]) from public, anon, authenticated;
grant execute on function spot_counts_with_linked(uuid[]) to service_role;

-- The series whose counts a sign-up for `p_keys` can change: those, and any
-- linked to them by an includes rule that counts headcount (either way).
create or replace function headcount_linked_keys(p_keys text[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(distinct k), '{}')
  from (
    select unnest(p_keys) as k
    union select key_a from event_link_rules where count_headcount and kind <> 'exclusive' and key_b = any(p_keys)
    union select key_b from event_link_rules where count_headcount and kind <> 'exclusive' and key_a = any(p_keys)
  ) keys
  where k is not null;
$$;

-- Same as 0061, without included_by, and with capacity counted by
-- spot_counts_with_linked over every series the sign-up's counts reach.
create or replace function register_submission(p_submission jsonb, p_rows jsonb) returns uuid
language plpgsql as $$
declare
  v_keys text[];
  v_ids uuid[];
  v_event_ids uuid[];
  v_before jsonb;
  v_submission_id uuid;
  v_over record;
begin
  select coalesce(array_agg(distinct r ->> 'series_key'), '{}')
  into v_keys
  from jsonb_array_elements(coalesce(p_rows, '[]')) r
  where r ->> 'series_key' is not null;
  v_keys := headcount_linked_keys(v_keys);
  v_ids := array(
    select k::uuid from unnest(v_keys) k
    where k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

  -- No one else can change these series' counts until this commits.
  perform lock_series_spot_counts(v_keys);

  v_event_ids := array(select e.id from events e where e.google_recurring_event_id = any(v_keys) or e.id = any(v_ids));
  select coalesce(jsonb_object_agg(s.event_id::text, jsonb_build_array(s.taken, s.leaders_taken, s.followers_taken)), '{}')
  into v_before
  from spot_counts_with_linked(v_event_ids) s;

  insert into intake_submissions (
    registration_type, first_name, last_name, email, phone, instagram, whatsapp,
    class, comments, dancers, payment_method, guidelines_agreed_at
  )
  select
    registration_type, first_name, last_name, email, phone, instagram, whatsapp,
    class, comments, dancers, payment_method, guidelines_agreed_at
  from jsonb_populate_record(null::intake_submissions, p_submission)
  returning id into v_submission_id;

  insert into class_registrations (
    submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, is_drop_in,
    deal_id, deal_name, deal_discount
  )
  select
    v_submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, coalesce(is_drop_in, false),
    deal_id, deal_name, deal_discount
  from jsonb_populate_recordset(null::class_registrations, coalesce(p_rows, '[]'));

  -- The insert trigger has recounted. Any upcoming class whose count (with
  -- linked headcount) went up past its cap refuses the whole sign-up.
  select e.title, o.role, greatest(o.cap - o.before, 0) as remaining
  into v_over
  from events e
  join spot_counts_with_linked(v_event_ids) c on c.event_id = e.id
  cross join lateral (
    values
      ('', e.capacity, c.taken, coalesce((v_before -> e.id::text ->> 0)::int, 0), not e.capacity_by_role),
      ('leader', e.leader_capacity, c.leaders_taken, coalesce((v_before -> e.id::text ->> 1)::int, 0), e.capacity_by_role),
      ('follower', e.follower_capacity, c.followers_taken, coalesce((v_before -> e.id::text ->> 2)::int, 0), e.capacity_by_role)
  ) o(role, cap, now_taken, before, in_force)
  where (e.start_time >= now() or (e.event_type = 'event' and e.end_time + interval '30 minutes' >= now()))
    and o.in_force
    and o.cap > 0
    and o.now_taken > o.cap
    and o.now_taken > o.before
  order by e.start_time, o.role
  limit 1;

  if found then
    raise exception 'capacity_exceeded'
      using errcode = 'P0001',
            detail = jsonb_build_object('title', v_over.title, 'role', v_over.role, 'remaining', v_over.remaining)::text;
  end if;

  return v_submission_id;
end;
$$;

revoke all on function register_submission(jsonb, jsonb) from public, anon, authenticated;
grant execute on function register_submission(jsonb, jsonb) to service_role;

-- Same as 0061, now also carrying count_headcount when a rebuilt series' rules move.
create or replace function remap_series_key(p_old text, p_new text) returns void
language plpgsql as $$
begin
  if p_old is null or p_new is null or p_old = p_new then
    return;
  end if;
  update event_links set series_key = p_new where series_key = p_old;
  insert into event_link_rules (key_a, key_b, kind, reason, count_headcount, updated_at)
  select least(k_a, k_b), greatest(k_a, k_b),
         case when kind = 'exclusive' then 'exclusive'
              when (kind = 'a_includes_b') = (k_a < k_b) then 'a_includes_b'
              else 'b_includes_a' end,
         reason, count_headcount, now()
  from (
    select case when key_a = p_old then p_new else key_a end as k_a,
           case when key_b = p_old then p_new else key_b end as k_b,
           kind, reason, count_headcount
    from event_link_rules
    where key_a = p_old or key_b = p_old
  ) moved
  where k_a <> k_b
  on conflict (key_a, key_b) do update set kind = excluded.kind, reason = excluded.reason, count_headcount = excluded.count_headcount, updated_at = now();
  delete from event_link_rules where key_a = p_old or key_b = p_old;
  update deals set series_keys = array_replace(series_keys, p_old, p_new) where p_old = any(series_keys);
end;
$$;

revoke all on function remap_series_key(text, text) from public, anon, authenticated;
grant execute on function remap_series_key(text, text) to service_role;
