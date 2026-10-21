// Browser-only. Every admin-gated page asks this whether the visitor is a
// signed-in admin. When the server rejects the stored session (expired, or
// ended elsewhere, e.g. a global sign-out), it refreshes the session once
// before giving up; if that fails too, the stale session is cleared locally so
// the page shows "sign in" rather than wrongly saying the account isn't an
// admin. When the check itself can't be made (offline, or the server or
// Supabase Auth is having trouble), it says so ('unavailable') and leaves the
// session alone, rather than calling a real admin "not an admin" or signing
// them out.
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabaseBrowser';

export type AdminGate =
  | { status: 'signedOut' }
  | { status: 'unavailable' }
  | { status: 'notAdmin'; session: Session }
  | { status: 'admin'; session: Session };

type TokenCheck = 'admin' | 'notAdmin' | 'invalid' | 'unavailable';

async function checkToken(accessToken: string): Promise<TokenCheck> {
  try {
    const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return 'unavailable';
    const body = await res.json();
    if (body.isAdmin) return 'admin';
    return body.sessionInvalid ? 'invalid' : 'notAdmin';
  } catch {
    return 'unavailable';
  }
}

export async function checkAdminSession(): Promise<AdminGate> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  if (!session) return { status: 'signedOut' };

  const first = await checkToken(session.access_token);
  if (first === 'admin' || first === 'notAdmin') return { status: first, session };
  if (first === 'unavailable') return { status: 'unavailable' };

  const { data, error } = await supabaseBrowser.auth.refreshSession();
  if (!error && data.session) {
    const second = await checkToken(data.session.access_token);
    if (second === 'admin' || second === 'notAdmin') return { status: second, session: data.session };
    if (second === 'unavailable') return { status: 'unavailable' };
  }
  // The refresh couldn't reach Supabase, or Supabase was rate limiting or
  // having trouble: the session may well still be good.
  if (error && (error.name === 'AuthRetryableFetchError' || error.status === 429 || (error.status ?? 0) >= 500)) return { status: 'unavailable' };

  // Only this browser's copy: never end the account's other sessions.
  await supabaseBrowser.auth.signOut({ scope: 'local' });
  return { status: 'signedOut' };
}
