import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { authStorageKey, checkAdminSessionIfStored, mightHaveSession } from '../../src/lib/sessionHint';

// Public pages only download the Supabase client when this says a session
// might be stored (src/lib/sessionHint.ts).
const URL_ = 'https://abcdefghijkl.supabase.co';
const KEY = authStorageKey(URL_);
const store = (data: Record<string, string>) => () => ({ getItem: (k: string) => data[k] ?? null });

describe('the stored-session hint', () => {
  it('uses the same key as the Supabase client itself', () => {
    const client = createClient(URL_, 'anon-key', { auth: { persistSession: false, autoRefreshToken: false } });
    expect(KEY).toBe('sb-abcdefghijkl-auth-token');
    expect((client.auth as unknown as { storageKey: string }).storageKey).toBe(KEY);
  });

  it('a stored session (access or refresh token) counts', () => {
    expect(mightHaveSession(store({ [KEY]: JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 1 }) }), KEY)).toBe(true);
    expect(mightHaveSession(store({ [KEY]: JSON.stringify({ refresh_token: 'r' }) }), KEY)).toBe(true);
  });

  it('nothing stored, or under another key, is signed out', () => {
    expect(mightHaveSession(store({}), KEY)).toBe(false);
    expect(mightHaveSession(store({ 'sb-other-auth-token': JSON.stringify({ access_token: 'a' }) }), KEY)).toBe(false);
    expect(mightHaveSession(() => undefined, KEY)).toBe(false);
  });

  it('malformed or token-less values are signed out', () => {
    for (const raw of ['{not json', 'null', '"text"', '42', '[]', '{}', JSON.stringify({ access_token: '' }), JSON.stringify({ access_token: 5 })]) {
      expect(mightHaveSession(store({ [KEY]: raw }), KEY), raw).toBe(false);
    }
  });

  it('storage that throws (blocked, private mode) is signed out, never an error', () => {
    const throwsOnRead = () => ({
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    const throwsOnAccess = () => {
      throw new Error('SecurityError');
    };
    expect(mightHaveSession(throwsOnRead, KEY)).toBe(false);
    expect(mightHaveSession(throwsOnAccess, KEY)).toBe(false);
  });

  it('with no stored session the admin check answers signed out without loading the client', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubEnv('PUBLIC_SUPABASE_URL', URL_);
    try {
      await expect(checkAdminSessionIfStored()).resolves.toEqual({ status: 'signedOut' });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
