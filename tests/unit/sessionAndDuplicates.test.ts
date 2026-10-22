import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../src/lib/supabaseBrowser', () => ({ supabaseBrowser: { auth } }));

const bin = vi.hoisted(() => ({ softDeleteDancer: vi.fn(), softDeleteCheckin: vi.fn() }));
vi.mock('../../src/lib/recyclingBin', () => bin);

import { checkAdminSession } from '../../src/lib/adminSession';
import { GET as checkRoute } from '../../src/pages/api/admin/check';
import { flagDuplicateCheckins, flagDuplicateSubmission } from '../../src/lib/duplicateSubmissions';
import { DUPLICATE_DELETED_BY } from '../../src/lib/duplicateFlag';

describe('admin session gate', () => {
  const session = (token: string) => ({ access_token: token, user: { email: 'a@x' } });
  const answers = new Map<string, { isAdmin: boolean; sessionInvalid?: boolean }>();

  beforeEach(() => {
    answers.clear();
    auth.getSession.mockReset();
    auth.refreshSession.mockReset();
    auth.signOut.mockReset().mockResolvedValue({ error: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const token = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
        return new Response(JSON.stringify(answers.get(token) ?? { isAdmin: false }));
      })
    );
  });

  it('lets an admin in and tells a signed-in non-admin apart from a signed-out visitor', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect((await checkAdminSession()).status).toBe('signedOut');

    auth.getSession.mockResolvedValue({ data: { session: session('ok') } });
    answers.set('ok', { isAdmin: true });
    expect((await checkAdminSession()).status).toBe('admin');

    answers.set('ok', { isAdmin: false });
    expect((await checkAdminSession()).status).toBe('notAdmin');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('makes one check when the header and the page ask at the same time (each used to make its own)', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('stale') } });
    answers.set('stale', { isAdmin: false, sessionInvalid: true });
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresh') }, error: null });
    answers.set('fresh', { isAdmin: true });
    const [header, page] = await Promise.all([checkAdminSession(), checkAdminSession()]);
    expect(header.status).toBe('admin');
    expect(page.status).toBe('admin');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    // Once settled, the next check asks again.
    await checkAdminSession();
    expect(auth.getSession).toHaveBeenCalledTimes(2);
  });

  it('refreshes a session the server rejected instead of reporting "not an admin"', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('stale') } });
    answers.set('stale', { isAdmin: false, sessionInvalid: true });
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresh') }, error: null });
    answers.set('fresh', { isAdmin: true });
    const gate = await checkAdminSession();
    expect(gate.status).toBe('admin');
  });

  it("signs out only this browser when the session can't be recovered (a global sign-out logged admins out everywhere)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('stale') } });
    answers.set('stale', { isAdmin: false, sessionInvalid: true });
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'expired' } });
    expect((await checkAdminSession()).status).toBe('signedOut');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("says the check is unavailable, never 'not an admin', when the server can't be reached or errors", async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('ok') } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await checkAdminSession()).status).toBe('unavailable');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    expect((await checkAdminSession()).status).toBe('unavailable');
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("keeps the session when the refresh itself can't reach Supabase", async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('stale') } });
    answers.set('stale', { isAdmin: false, sessionInvalid: true });
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } });
    expect((await checkAdminSession()).status).toBe('unavailable');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('keeps the session when the refresh is rate limited or Supabase Auth errors', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session('stale') } });
    answers.set('stale', { isAdmin: false, sessionInvalid: true });
    for (const status of [429, 500]) {
      auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', status, message: 'nope' } });
      expect((await checkAdminSession()).status).toBe('unavailable');
    }
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe('admin check endpoint', () => {
  beforeEach(() => {
    db.current = new FakeSupabase();
  });

  const get = () => checkRoute({ request: new Request('http://x/api/admin/check', { headers: { Authorization: 'Bearer t' } }) } as never);

  it('reports an outage of Supabase Auth as 503, not as an invalid session (which signs the admin out)', async () => {
    (db.current as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: null }, error: { status: 0, message: 'fetch failed' } }) };
    expect((await get()).status).toBe(503);
    (db.current as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: null }, error: { status: 502, message: 'bad gateway' } }) };
    expect((await get()).status).toBe(503);
    (db.current as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: null }, error: { status: 429, message: 'rate limited' } }) };
    expect((await get()).status).toBe(503);
  });

  it('still calls a rejected token invalid, and a valid non-admin token not an admin', async () => {
    (db.current as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: null }, error: { status: 403, message: 'bad_jwt' } }) };
    expect(await (await get()).json()).toEqual({ isAdmin: false, sessionInvalid: true });
    (db.current as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: { email: 'someone@else.com' } }, error: null }) };
    expect(await (await get()).json()).toEqual({ isAdmin: false, sessionInvalid: false });
  });
});

describe('duplicate submissions', () => {
  const sub = (id: string, minutesAgo: number, over: Record<string, unknown> = {}) => ({
    id,
    created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    deleted_at: null,
    registration_type: 'group',
    first_name: 'Jo',
    last_name: 'Doe',
    email: 'jo@x.com',
    phone: null,
    class: 'Bachata 1',
    comments: null,
    payment_method: 'cash',
    dancers: [{ firstName: 'Jo', lastName: 'Doe', role: 'leader', email: 'jo@x.com', phone: '' }],
    ...over,
  });

  beforeEach(() => {
    db.current = new FakeSupabase();
    bin.softDeleteDancer.mockReset().mockResolvedValue(undefined);
    bin.softDeleteCheckin.mockReset().mockResolvedValue(undefined);
  });

  it('moves the newer copy of a double-submitted sign-up to the Recycling Bin and points at the original', async () => {
    db.current.seed('intake_submissions', [sub('orig', 2), sub('dup', 0, { first_name: ' jo ', class: 'BACHATA 1' })]);
    expect(await flagDuplicateSubmission('dup')).toBe('orig');
    expect(bin.softDeleteDancer).toHaveBeenCalledWith('dup', null, DUPLICATE_DELETED_BY);
  });

  it('keeps sign-ups that differ in anything the dancer typed (e.g. a role), or are older than the window', async () => {
    db.current.seed('intake_submissions', [sub('orig', 2), sub('other-role', 0, { dancers: [{ firstName: 'Jo', lastName: 'Doe', role: 'follower', email: 'jo@x.com' }] })]);
    expect(await flagDuplicateSubmission('other-role')).toBeNull();
    db.current.seed('intake_submissions', [sub('old', 45), sub('again', 0)]);
    expect(await flagDuplicateSubmission('again')).toBeNull();
    expect(bin.softDeleteDancer).not.toHaveBeenCalled();
  });

  it('never flags the original itself', async () => {
    db.current.seed('intake_submissions', [sub('orig', 2), sub('dup', 0)]);
    expect(await flagDuplicateSubmission('orig')).toBeNull();
  });

  it('only treats a check-in as a duplicate when the name AND phone match for the same class', async () => {
    const ci = (id: string, minutesAgo: number, over: Record<string, unknown> = {}) => ({
      id,
      created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
      deleted_at: null,
      first_name: 'Jo',
      last_name: 'Doe',
      phone: '(608) 555-0100',
      class_title: 'Bachata 1',
      event_id: 'occ',
      ...over,
    });
    db.current.seed('class_checkins', [ci('a', 5), ci('b', 0, { phone: '608-555-0100' }), ci('c', 0, { phone: '608-555-0199' }), ci('d', 0, { phone: null })]);
    const originals = await flagDuplicateCheckins(['b', 'c', 'd']);
    expect([...originals]).toEqual([['b', 'a']]);
    expect(bin.softDeleteCheckin).toHaveBeenCalledWith('b', DUPLICATE_DELETED_BY);
  });
});
