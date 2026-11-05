-- Claims several units of a daily usage counter at once (increment_api_usage
-- claims one): a feedback request emails up to 200 dancers in one go. Grants
-- what's left under the cap, up to p_amount, and returns how many it granted.
-- A negative p_amount gives units back (a send that failed), never below zero.

create or replace function claim_api_usage(p_api text, p_day date, p_cap integer, p_amount integer)
returns integer
language plpgsql
as $$
declare
  current_count integer;
  granted integer;
begin
  insert into api_usage_daily (api, day, count)
  values (p_api, p_day, 0)
  on conflict (api, day) do nothing;

  select count into current_count from api_usage_daily where api = p_api and day = p_day for update;

  if p_amount < 0 then
    update api_usage_daily set count = greatest(count + p_amount, 0) where api = p_api and day = p_day;
    return p_amount;
  end if;

  granted := least(p_amount, greatest(p_cap - current_count, 0));
  update api_usage_daily set count = count + granted where api = p_api and day = p_day;
  return granted;
end;
$$;

grant execute on function claim_api_usage(text, date, integer, integer) to service_role;
