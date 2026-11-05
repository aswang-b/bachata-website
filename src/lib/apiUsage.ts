import { supabase } from './supabase';
import { usageCountersDisabled } from './testMode';

/**
 * Atomically checks + increments today's usage counter for a paid API.
 * Returns false once `dailyCap` is reached for the day, so callers can
 * gracefully degrade instead of racking up unbounded third-party cost.
 * Fails open (returns true) if our own bookkeeping errors out — a tracking
 * bug shouldn't be the reason a feature stops working.
 */
export async function checkAndIncrementUsage(api: string, dailyCap: number): Promise<boolean> {
  if (usageCountersDisabled()) return true;
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

/**
 * Claims up to `amount` units of today's counter at once and resolves to how
 * many were granted (fewer once the cap is near). A negative amount gives
 * units back. Fails open like checkAndIncrementUsage, including before
 * migration 0067 has added the function.
 */
export async function claimUsage(api: string, dailyCap: number, amount: number): Promise<number> {
  if (usageCountersDisabled() || amount === 0) return amount;
  const { data, error } = await supabase.rpc('claim_api_usage', {
    p_api: api,
    p_day: new Date().toISOString().slice(0, 10),
    p_cap: dailyCap,
    p_amount: amount,
  });
  if (error || typeof data !== 'number') {
    console.error(`Failed to claim usage for ${api}:`, error?.message);
    return amount;
  }
  return data;
}
