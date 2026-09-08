import { supabase } from './supabase';

/**
 * Atomically checks + increments today's usage counter for a paid API.
 * Returns false once `dailyCap` is reached for the day, so callers can
 * gracefully degrade instead of racking up unbounded third-party cost.
 * Fails open (returns true) if our own bookkeeping errors out — a tracking
 * bug shouldn't be the reason a feature stops working.
 */
export async function checkAndIncrementUsage(api: string, dailyCap: number): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc('increment_api_usage', {
    p_api: api,
    p_day: today,
    p_cap: dailyCap,
  });

  if (error) {
    console.error(`Failed to check/increment usage for ${api}:`, error.message);
    return true;
  }

  return Boolean(data);
}
