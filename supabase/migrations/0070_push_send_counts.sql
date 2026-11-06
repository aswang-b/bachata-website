-- Run this in the Supabase SQL editor after 0001-0069, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- How each push notification did on the phones and computers it reached:
-- how many showed it, and how many were tapped. The service worker
-- (public/sw.js) reports each once, with only the send's id: nothing about the
-- device or person. Neither count can pass `delivered`, so made-up reports
-- can't inflate them, and only sends from the last 30 days are counted.

alter table push_sends
  add column if not exists shown integer not null default 0,
  add column if not exists opened integer not null default 0;

create or replace function count_push_send(p_id uuid, p_kind text)
returns boolean
language plpgsql
as $$
begin
  if p_kind = 'shown' then
    update push_sends set shown = least(shown + 1, delivered)
    where id = p_id and created_at > now() - interval '30 days';
  elsif p_kind = 'opened' then
    update push_sends set opened = least(opened + 1, delivered)
    where id = p_id and created_at > now() - interval '30 days';
  else
    return false;
  end if;
  return found;
end;
$$;

revoke all on function count_push_send(uuid, text) from public, anon, authenticated;
grant execute on function count_push_send(uuid, text) to service_role;
