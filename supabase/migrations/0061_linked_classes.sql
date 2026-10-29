-- Run this in the Supabase SQL editor after 0001-0060, BEFORE deploying the
-- code that links classes and events. Safe to re-run.
--
-- Linked classes/events (the editor's "Linked Classes/Events" section, see
-- src/lib/linkRules.ts): classes or events sold off one flyer are linked as
-- whole series, and each linked pair can have a rule: can take both (no row),
-- cannot take both, or one includes the other. A series is named by its
-- series key (google_recurring_event_id ?? id), like deals and sign-ups.

create table if not exists event_links (
  series_key text primary key,
  link_group_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists event_links_group_idx on event_links (link_group_id);

-- One row per linked pair that has a rule, stored with key_a < key_b.
create table if not exists event_link_rules (
  key_a text not null,
  key_b text not null,
  kind text not null check (kind in ('exclusive', 'a_includes_b', 'b_includes_a')),
  -- The admin's own wording for the registration form's note; null shows the default.
  reason text check (reason is null or char_length(reason) <= 200),
  updated_at timestamptz not null default now(),
  primary key (key_a, key_b),
  check (key_a < key_b)
);

-- Server only (see 0045).
alter table event_links enable row level security;
revoke all on table event_links from anon, authenticated;
grant select, insert, update, delete on table event_links to service_role;
alter table event_link_rules enable row level security;
revoke all on table event_link_rules from anon, authenticated;
grant select, insert, update, delete on table event_link_rules to service_role;

-- A $0 sign-up that comes with another one ("Workshop includes Practica"):
-- the series key of the class/event that included it.
alter table class_registrations add column if not exists included_by text;

-- Rebuilding a series on Google gives it a new series key; its links, rules
-- and deals follow it (update-event.ts calls this after moving its sign-ups).
create or replace function remap_series_key(p_old text, p_new text) returns void
language plpgsql as $$
begin
  if p_old is null or p_new is null or p_old = p_new then
    return;
  end if;
  update event_links set series_key = p_new where series_key = p_old;
  insert into event_link_rules (key_a, key_b, kind, reason, updated_at)
  select least(k_a, k_b), greatest(k_a, k_b),
         case when kind = 'exclusive' then 'exclusive'
              when (kind = 'a_includes_b') = (k_a < k_b) then 'a_includes_b'
              else 'b_includes_a' end,
         reason, now()
  from (
    select case when key_a = p_old then p_new else key_a end as k_a,
           case when key_b = p_old then p_new else key_b end as k_b,
           kind, reason
    from event_link_rules
    where key_a = p_old or key_b = p_old
  ) moved
  where k_a <> k_b
  on conflict (key_a, key_b) do update set kind = excluded.kind, reason = excluded.reason, updated_at = now();
  delete from event_link_rules where key_a = p_old or key_b = p_old;
  update deals set series_keys = array_replace(series_keys, p_old, p_new) where p_old = any(series_keys);
end;
$$;

revoke all on function remap_series_key(text, text) from public, anon, authenticated;
grant execute on function remap_series_key(text, text) to service_role;

-- Same as 0053, now also saving each row's included_by.
create or replace function register_submission(p_submission jsonb, p_rows jsonb) returns uuid
language plpgsql as $$
declare
  v_keys text[];
  v_ids uuid[];
  v_before jsonb;
  v_submission_id uuid;
  v_over record;
begin
  select coalesce(array_agg(distinct r ->> 'series_key'), '{}')
  into v_keys
  from jsonb_array_elements(coalesce(p_rows, '[]')) r
  where r ->> 'series_key' is not null;
  v_ids := array(
    select k::uuid from unnest(v_keys) k
    where k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

  -- No one else can change these series' counts until this commits.
  perform lock_series_spot_counts(v_keys);

  select coalesce(jsonb_object_agg(c.event_id::text, jsonb_build_array(c.taken, c.leaders_taken, c.followers_taken)), '{}')
  into v_before
  from event_spot_counts c
  join events e on e.id = c.event_id
  where e.google_recurring_event_id = any(v_keys) or e.id = any(v_ids);

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
    deal_id, deal_name, deal_discount, included_by
  )
  select
    v_submission_id, dancer_index, first_name, last_name, email, phone, class_title, class_label,
    series_key, series_mode, price, price_tier, occurrence_event_id, coalesce(is_drop_in, false),
    deal_id, deal_name, deal_discount, included_by
  from jsonb_populate_recordset(null::class_registrations, coalesce(p_rows, '[]'));

  -- The insert trigger has recounted. Any upcoming class whose count went up
  -- past its cap refuses the whole sign-up.
  select e.title, o.role, greatest(o.cap - o.before, 0) as remaining
  into v_over
  from events e
  join event_spot_counts c on c.event_id = e.id
  cross join lateral (
    values
      ('', e.capacity, c.taken, coalesce((v_before -> e.id::text ->> 0)::int, 0), not e.capacity_by_role),
      ('leader', e.leader_capacity, c.leaders_taken, coalesce((v_before -> e.id::text ->> 1)::int, 0), e.capacity_by_role),
      ('follower', e.follower_capacity, c.followers_taken, coalesce((v_before -> e.id::text ->> 2)::int, 0), e.capacity_by_role)
  ) o(role, cap, now_taken, before, in_force)
  where (e.google_recurring_event_id = any(v_keys) or e.id = any(v_ids))
    -- Classes until they start; events until 30 minutes after they end (door sign-ups).
    and (e.start_time >= now() or (e.event_type = 'event' and e.end_time + interval '30 minutes' >= now()))
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

-- Classes/events of one type that already share a flyer start out linked
-- (no rules yet). Series already linked are left alone, so re-running is safe.
insert into event_links (series_key, link_group_id)
select distinct on (series_key) series_key, link_group_id
from (
  select
    coalesce(e.google_recurring_event_id, e.id::text) as series_key,
    -- One group per flyer and type (an md5 is a valid uuid).
    md5(e.flyer_url || '|' || e.event_type)::uuid as link_group_id
  from events e
  where e.flyer_url is not null and e.visibility <> 'test'
) shared
where shared.link_group_id in (
  select md5(flyer_url || '|' || event_type)::uuid
  from events
  where flyer_url is not null and visibility <> 'test'
  group by flyer_url, event_type
  having count(distinct coalesce(google_recurring_event_id, id::text)) > 1
)
on conflict (series_key) do nothing;
