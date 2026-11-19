// Browser-only. Public pages ask whether the visitor is a signed-in admin
// (admin mode on the homepage and calendar, the header's admin links, the
// bell giving way to the inbox), but most visitors never signed in, and the
// Supabase client that answers is ~52 KB. So a page first looks, without it,
// for the session supabase-js keeps in localStorage; only when one might be
// there does it download the client and check as before (lib/adminSession.ts).
//
// This is a hint, never a permission: a stale or forged entry just costs a
// download and the usual check (which signs a dead session out locally), and
// every /api/admin/* route still checks the token itself (requireAdmin).
import type { AdminGate } from './adminSession';

// The key supabase-js keeps the session under by default (this project sets no
// storageKey): "sb-<project ref>-auth-token". tests/unit/sessionHint.test.ts
// checks it against the client itself.
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

type ReadableStorage = Pick<Storage, 'getItem'>;

// True when the stored value looks like a session supabase-js could use (an
// access or refresh token). Missing, unreadable or malformed: false, as the
// client itself would find no session there either.
export function mightHaveSession(storage: () => ReadableStorage | undefined, key: string): boolean {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return false;
    const { access_token, refresh_token } = value as Record<string, unknown>;
    return (typeof access_token === 'string' && access_token !== '') || (typeof refresh_token === 'string' && refresh_token !== '');
  } catch {
    return false;
  }
}

export function mightBeSignedIn(): boolean {
  const url = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
  if (!url) return false;
  return mightHaveSession(() => globalThis.localStorage, authStorageKey(url));
}

// checkAdminSession for public pages: signed out at once, with no download,
// when there's no stored session; otherwise the real check.
export async function checkAdminSessionIfStored(): Promise<AdminGate> {
  if (!mightBeSignedIn()) return { status: 'signedOut' };
  const { checkAdminSession } = await import('./adminSession');
  return checkAdminSession();
}

// The browser client, for a public page that already found an admin.
export async function loadSupabaseBrowser() {
  return (await import('./supabaseBrowser')).supabaseBrowser;
}
