import { supabase } from './supabase';

// The dashboard's Errors workqueue (site_errors, migration 0052): problems the
// site hit on its own, one line each, for an admin to fix or dismiss. A repeat
// of an open error with the same dedupeKey counts on its line instead.

// link_rule: a sign-up took both of a "Cannot take both" pair of linked classes (not an error, a check).
export type SiteErrorKind = 'email_bounce' | 'google_api' | 'google_auth' | 'email_send' | 'signup_save' | 'link_rule';

export interface SiteError {
  id: string;
  kind: SiteErrorKind | string;
  message: string;
  details: Record<string, unknown>;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const MAX_MESSAGE = 1000;

// Never throws (and never blocks what was going on): a failure to log is only
// written to the server log.
export async function logSiteError(kind: SiteErrorKind, message: string, opts: { details?: Record<string, unknown>; dedupeKey?: string } = {}): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_site_error', {
      p_kind: kind,
      p_message: message.slice(0, MAX_MESSAGE),
      p_details: opts.details ?? {},
      p_dedupe_key: opts.dedupeKey ?? null,
    });
    if (error) console.error('Failed to log a site error:', error.message, '—', message);
  } catch (err) {
    console.error('Failed to log a site error:', err, '—', message);
  }
}

export async function listOpenSiteErrors(): Promise<SiteError[]> {
  const { data, error } = await supabase
    .from('site_errors')
    .select('id, kind, message, details, count, first_seen_at, last_seen_at')
    .eq('status', 'open')
    .order('last_seen_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`Failed to load errors: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    message: r.message,
    details: (r.details ?? {}) as Record<string, unknown>,
    count: r.count,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }));
}

export async function getOpenSiteError(id: string): Promise<SiteError | null> {
  const { data, error } = await supabase.from('site_errors').select('id, kind, message, details, count, first_seen_at, last_seen_at').eq('id', id).eq('status', 'open').maybeSingle();
  if (error) throw new Error(`Failed to load the error: ${error.message}`);
  return data
    ? { id: data.id, kind: data.kind, message: data.message, details: (data.details ?? {}) as Record<string, unknown>, count: data.count, firstSeenAt: data.first_seen_at, lastSeenAt: data.last_seen_at }
    : null;
}

// Takes an error off the open list: 'resolved' when an action fixed it, 'dismissed' otherwise.
export async function closeSiteError(id: string, status: 'resolved' | 'dismissed', by: string): Promise<void> {
  const { error } = await supabase.from('site_errors').update({ status, closed_at: new Date().toISOString(), closed_by: by }).eq('id', id).eq('status', 'open');
  if (error) throw new Error(`Failed to update the error: ${error.message}`);
}
