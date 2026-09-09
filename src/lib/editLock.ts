import { supabase } from './supabase';

// Sign-ups, check-ins, and attendance each get their own lock so editing one
// never blocks the others — two admins can work on different tabs of
// /admin/analytics at the same time without contending for a single lock.
export const SIGNUPS_LOCK_RESOURCE = 'analytics-signups';
export const CHECKINS_LOCK_RESOURCE = 'analytics-checkins';
export const ATTENDANCE_LOCK_RESOURCE = 'analytics-attendance';
export const LOCK_TTL_SECONDS = 10 * 60; // 10 minutes; refreshed by a client heartbeat while editing.

export interface LockState {
  locked: boolean;
  lockedBy: string | null;
  expiresAt: string | null;
}

export async function getLockStatus(resource: string): Promise<LockState> {
  const { data, error } = await supabase.from('edit_locks').select('locked_by, expires_at').eq('resource', resource).maybeSingle();
  if (error) console.error('Failed to load lock status:', error.message);
  if (error || !data) return { locked: false, lockedBy: null, expiresAt: null };

  const active = new Date(data.expires_at).getTime() > Date.now();
  return { locked: active, lockedBy: active ? data.locked_by : null, expiresAt: active ? data.expires_at : null };
}

export async function tryAcquireLock(
  resource: string,
  holder: string
): Promise<{ acquired: boolean; lockedBy: string; expiresAt: string }> {
  const { data, error } = await supabase.rpc('try_acquire_lock', {
    p_resource: resource,
    p_holder: holder,
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error || !data || data.length === 0) throw new Error(error?.message ?? 'Failed to acquire lock.');
  const row = data[0];
  return { acquired: row.acquired, lockedBy: row.locked_by, expiresAt: row.expires_at };
}

export async function releaseLock(resource: string, holder: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('release_lock', { p_resource: resource, p_holder: holder });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

/** Throws if `holder` does not currently hold a valid, unexpired lock on `resource`. */
export async function requireLock(resource: string, holder: string): Promise<void> {
  const state = await getLockStatus(resource);
  if (!state.locked || state.lockedBy !== holder) {
    throw new Error('You must hold the edit lock to make changes. Try locking again.');
  }
}
