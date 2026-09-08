-- Run this in the Supabase SQL editor after 0001-0010.
-- Backs a simple daily usage cap for paid third-party APIs (Google Places
-- Autocomplete, Resend email) so a bug or abuse can't run up unbounded cost.

create table if not exists api_usage_daily (
  api text not null,
  day date not null,
  count integer not null default 0,
  primary key (api, day)
);

-- Atomically checks whether `api` is still under `p_cap` requests for `p_day`,
-- and if so increments its count and returns true. Row-level locking (via the
-- implicit transaction + the insert/select-for-update below) prevents a race
-- between concurrent requests from both slipping through under the cap.
create or replace function increment_api_usage(p_api text, p_day date, p_cap integer)
returns boolean
language plpgsql
as $$
declare
  current_count integer;
begin
  insert into api_usage_daily (api, day, count)
  values (p_api, p_day, 0)
  on conflict (api, day) do nothing;

  select count into current_count from api_usage_daily where api = p_api and day = p_day for update;

  if current_count >= p_cap then
    return false;
  end if;

  update api_usage_daily set count = count + 1 where api = p_api and day = p_day;
  return true;
end;
$$;
