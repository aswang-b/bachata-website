import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

import {
  deleteCalendarEvent,
  getGoogleAccessToken,
  GoogleAuthError,
  GoogleAuthExpiredError,
  GoogleNotConnectedError,
  listCalendarEvents,
  refreshAccessToken,
} from '../../src/lib/googleCalendar';

const CAL = 'https://www.googleapis.com/auth/calendar';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn();

beforeEach(() => {
  db.current = new FakeSupabase();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('stored Google tokens', () => {
  it('rejects a token that was granted without Calendar access', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'a', scope: 'openid email' }));
    await expect(refreshAccessToken('r')).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('treats invalid_grant (expired/revoked) as an unusable token, other errors as failures', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_grant' }));
    await expect(refreshAccessToken('r')).rejects.toBeInstanceOf(GoogleAuthError);
    fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_client' }));
    const err = await refreshAccessToken('r').catch((e) => e);
    expect(err).not.toBeInstanceOf(GoogleAuthError);
  });

  it('tries tokens freshest first and skips dead ones', async () => {
    db.current.seed('admin_google_tokens', [
      { email: 'old@x', refresh_token: 'old', updated_at: '2026-01-01T00:00:00Z' },
      { email: 'dead@x', refresh_token: 'dead', updated_at: '2026-09-01T00:00:00Z' },
    ]);
    fetchMock.mockImplementation(async (_url, init) => {
      const token = new URLSearchParams(String(init.body)).get('refresh_token');
      return token === 'dead' ? json(400, { error: 'invalid_grant' }) : json(200, { access_token: `access-${token}`, scope: `openid ${CAL}` });
    });
    expect(await getGoogleAccessToken()).toBe('access-old');
    const tried = fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init.body)).get('refresh_token'));
    expect(tried).toEqual(['dead', 'old']);
  });

  it('explains what to do when there is no usable token', async () => {
    await expect(getGoogleAccessToken()).rejects.toBeInstanceOf(GoogleNotConnectedError);
    db.current.seed('admin_google_tokens', [{ email: 'a', refresh_token: 'x', updated_at: '2026-01-01' }]);
    fetchMock.mockResolvedValue(json(400, { error: 'invalid_grant' }));
    await expect(getGoogleAccessToken()).rejects.toBeInstanceOf(GoogleAuthExpiredError);
  });
});

describe('Calendar API calls', () => {
  it('backs off and retries when Google says the rate limit was exceeded', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(json(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }))
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, { items: [{ id: 'e1' }] }));
    const promise = listCalendarEvents('t', 'public', 'a', 'b');
    await vi.runAllTimersAsync();
    expect(await promise).toEqual([{ id: 'e1' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 403 that is not a rate limit (e.g. missing scopes)', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }));
    await expect(listCalendarEvents('t', 'public', 'a', 'b')).rejects.toThrow('403');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats deleting an already-deleted event as done', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 410 }));
    await expect(deleteCalendarEvent('t', 'public', 'gone')).resolves.toBeUndefined();
  });

  it("refuses an e2e 'test' row, which has no calendar, without calling Google", async () => {
    await expect(deleteCalendarEvent('t', 'test', 'zzz-e2e-1')).rejects.toThrow('no Google Calendar');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows pagination', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { items: [{ id: '1' }], nextPageToken: 'p2' })).mockResolvedValueOnce(json(200, { items: [{ id: '2' }] }));
    expect((await listCalendarEvents('t', 'private', 'a', 'b')).map((e) => e.id)).toEqual(['1', '2']);
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
  });
});
