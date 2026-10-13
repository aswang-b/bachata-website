// Browser-only. Every admin-gated page asks this whether the visitor is a
// signed-in admin. When the server rejects the stored session (expired, or
// ended elsewhere, e.g. a global sign-out), it refreshes the session once
// before giving up; if that fails too, the stale session is cleared locally so
// the page shows "sign in" rather than wrongly saying the account isn't an
// admin.
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser } from './supabaseBrowser';

export type AdminGate = { status: 'signedOut' } | { status: 'notAdmin'; session: Session } | { status: 'admin'; session: Session };

async function checkToken(accessToken: string): Promise<{ isAdmin: boolean; sessionInvalid: boolean }> {
  try {
    const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await res.json();
    return { isAdmin: Boolean(body.isAdmin), sessionInvalid: Boolean(body.sessionInvalid) };
  } catch {
    return { isAdmin: false, sessionInvalid: false };
  }
}

export async function checkAdminSession(): Promise<AdminGate> {
  const {
    data: { session },
  } = await supabaseBrowser.auth.getSession();
  if (!session) return { status: 'signedOut' };

  const first = await checkToken(session.access_token);
  if (first.isAdmin) return { status: 'admin', session };
  if (!first.sessionInvalid) return { status: 'notAdmin', session };

  const { data, error } = await supabaseBrowser.auth.refreshSession();
  if (!error && data.session) {
    const second = await checkToken(data.session.access_token);
    if (second.isAdmin) return { status: 'admin', session: data.session };
    if (!second.sessionInvalid) return { status: 'notAdmin', session: data.session };
  }

  // Only this browser's copy: never end the account's other sessions.
  await supabaseBrowser.auth.signOut({ scope: 'local' });
  return { status: 'signedOut' };
}
