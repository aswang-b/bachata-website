-- Run this in the Supabase SQL editor after 0001-0072, BEFORE deploying the
-- code that reads it. Safe to re-run.
--
-- Push notifications go out in chunks (one request each, so none can run
-- past the hosting's time limit): a send records how many devices it was for
-- (`target`) and when it reached them all (`finished_at`; null while it's
-- still going, or if it stopped and can be continued). `delivered` now
-- counts up as each chunk goes out, and a device's `last_sent_at` is when it
-- was last tried, so a chunk never repeats one. The devices' shown/opened
-- reports are capped at the target instead.

alter table push_sends
  add column if not exists target integer,
  add column if not exists finished_at timestamptz;

-- Sends before this were finished at once.
update push_sends set target = delivered, finished_at = created_at where target is null;

create or replace function count_push_send(p_id uuid, p_kind text)
returns boolean
language plpgsql
as $$
begin
  if p_kind = 'shown' then
    update push_sends set shown = least(shown + 1, coalesce(target, delivered))
    where id = p_id and created_at > now() - interval '30 days';
  elsif p_kind = 'opened' then
    update push_sends set opened = least(opened + 1, coalesce(target, delivered))
    where id = p_id and created_at > now() - interval '30 days';
  else
    return false;
  end if;
  return found;
end;
$$;

revoke all on function count_push_send(uuid, text) from public, anon, authenticated;
grant execute on function count_push_send(uuid, text) to service_role;
