import { createClient, type Session } from '@supabase/supabase-js';
import type { BrowserContext } from '@playwright/test';
import { db } from './db';
import { env } from './env';

// A real admin session for tests, made without a password: the service role
// issues a magic-link token and the anon client redeems it. Always end it
// with endAdminSession, which signs out ONLY this session — a default
// (global) sign-out would log the real admin out on every device.
export async function createAdminSession(): Promise<Session> {
  const email = env('ADMIN_EMAIL').split(',')[0].trim();
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw new Error(`generateLink failed: ${link.error.message}`);
  const anon = createClient(env('PUBLIC_SUPABASE_URL'), env('PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
  const { data, error } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
  if (error || !data.session) throw new Error(`verifyOtp failed: ${error?.message}`);
  return data.session;
}

export async function endAdminSession(session: Session | null | undefined): Promise<void> {
  if (!session) return;
  await db.auth.admin.signOut(session.access_token, 'local').catch(() => undefined);
}

// The localStorage key supabase-js keeps the browser session under.
export const authStorageKey = () => `sb-${new URL(env('PUBLIC_SUPABASE_URL')).hostname.split('.')[0]}-auth-token`;

// Signs the browser context in as that session before any page script runs.
export async function signInBrowser(context: BrowserContext, session: Pick<Session, 'access_token' | 'refresh_token' | 'expires_at' | 'expires_in' | 'token_type' | 'user'>) {
  await context.addInitScript(
    ([key, value]) => {
      // Only seed it once, so a page that refreshes or signs out isn't undone by the next navigation.
      if (!sessionStorage.getItem('__e2e_seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('__e2e_seeded', '1');
      }
    },
    [authStorageKey(), JSON.stringify(session)] as const
  );
}

export const bearer = (session: Session) => ({ Authorization: `Bearer ${session.access_token}` });
