-- Run this in the Supabase SQL editor after 0001-0016.
-- A conservative pessimistic lock gating inline editing on /admin/analytics —
-- only one admin session (tab) may hold it at a time, so two edits can never
-- clobber each other. `resource` lets the same mechanism cover multiple
-- editable areas later; today only 'analytics' is used.

create table if not exists edit_locks (
  resource text primary key,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Atomically acquires the lock for p_holder if it's free, expired, or already
-- held by p_holder (re-acquire extends it) — otherwise reports who holds it.
create or replace function try_acquire_lock(p_resource text, p_holder text, p_ttl_seconds integer)
returns table(acquired boolean, locked_by text, expires_at timestamptz)
language plpgsql
as $$
declare
  existing record;
  new_expiry timestamptz := now() + (p_ttl_seconds || ' seconds')::interval;
begin
  select * into existing from edit_locks where resource = p_resource for update;

  if existing is null then
    insert into edit_locks (resource, locked_by, locked_at, expires_at)
    values (p_resource, p_holder, now(), new_expiry);
    return query select true, p_holder, new_expiry;
  elsif existing.expires_at < now() or existing.locked_by = p_holder then
    update edit_locks set locked_by = p_holder, locked_at = now(), expires_at = new_expiry
    where resource = p_resource;
    return query select true, p_holder, new_expiry;
  else
    return query select false, existing.locked_by, existing.expires_at;
  end if;
end;
$$;

-- Releases the lock only if p_holder is the current holder (or it's already
-- expired) — never lets a session release someone else's active lock.
create or replace function release_lock(p_resource text, p_holder text)
returns boolean
language plpgsql
as $$
declare
  existing record;
begin
  select * into existing from edit_locks where resource = p_resource for update;
  if existing is null then
    return true;
  end if;
  if existing.locked_by <> p_holder and existing.expires_at > now() then
    return false;
  end if;
  delete from edit_locks where resource = p_resource;
  return true;
end;
$$;
