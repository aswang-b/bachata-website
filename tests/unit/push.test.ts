import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

const db = vi.hoisted(() => ({ current: null as unknown as FakeSupabase }));
vi.mock('../../src/lib/supabase', () => ({
  get supabase() {
    return db.current;
  },
}));
const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { sendNotification } }));

import { CHUNK, cleanMessage, cleanPath, cleanSubscription, isPushEndpoint, lastSendFor, sendChunk, startSend, subscriberCounts } from '../../src/lib/push';

// Push notifications (lib/push.ts): what's accepted as a phone's subscription,
// what a notification may say and open, and sending to every phone, a chunk at a time.

const p256dh = 'B'.repeat(87);
const auth = 'a'.repeat(22);
const TOKEN = 'dEf4-gHiJkLmNoPqRsTuVwXyZ012345';
const FCM = `https://fcm.googleapis.com/fcm/send/${TOKEN}`;
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh, auth } });

describe('subscriptions', () => {
  it("only takes the push services' own addresses, in their own shapes, so the server never calls anywhere else", () => {
    for (const ok of [
      FCM,
      `https://fcm.googleapis.com/wp/${TOKEN}`,
      `https://web.push.apple.com/${TOKEN}`,
      `https://updates.push.services.mozilla.com/wpush/v2/${TOKEN}`,
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) {
      expect(isPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      FCM.replace('https', 'http'),
      `https://fcm.googleapis.com.evil.example/fcm/send/${TOKEN}`,
      `https://evilpush.apple.com/${TOKEN}`,
      `https://fcm.googleapis.com:8443/fcm/send/${TOKEN}`,
      `https://user@fcm.googleapis.com/fcm/send/${TOKEN}`,
      // On a push host, but not a push address.
      'https://fcm.googleapis.com/fcm/send/abc',
      `https://fcm.googleapis.com/v1/projects/${TOKEN}`,
      `https://updates.push.services.mozilla.com/admin/${TOKEN}`,
      `${FCM}#x`,
      'https://localhost/x',
      'https://169.254.169.254/latest',
      42,
    ]) {
      expect(isPushEndpoint(bad), String(bad)).toBe(false);
    }
  });

  it('needs both of the keys a message is encrypted with, and keeps the phone type to count by', () => {
    expect(cleanSubscription(sub(FCM), 'android')).toEqual({ endpoint: FCM, p256dh, auth, platform: 'android' });
    expect(cleanSubscription(sub(`https://web.push.apple.com/${TOKEN}`), 'windows phone')!.platform).toBe('other');
    expect(cleanSubscription({ endpoint: FCM, keys: { p256dh } }, 'ios')).toBeNull();
    expect(cleanSubscription({ endpoint: FCM, keys: { p256dh: 'short', auth } }, 'ios')).toBeNull();
    expect(cleanSubscription({ endpoint: FCM, keys: { p256dh: `${p256dh.slice(1)}<`, auth } }, 'ios')).toBeNull();
    expect(cleanSubscription(null, 'ios')).toBeNull();
  });
});

describe('what a notification says and opens', () => {
  it('opens only pages on this site', () => {
    expect(cleanPath('/register')).toBe('/register');
    expect(cleanPath('https://dancewithb.fun/register/events')).toBe('/register/events');
    expect(cleanPath('https://www.dancewithb.fun')).toBe('/');
    for (const bad of ['//evil.example', 'https://evil.example/', 'javascript:alert(1)', '/\\evil.example', '/a b', 'register', 'https://dancewithb.fun.evil.example/']) {
      expect(cleanPath(bad), bad).toBeNull();
    }
  });

  it('needs a title and a message short enough for a phone, and tidies their spaces', () => {
    expect(cleanMessage({ title: '  New class:\n Bachata ', body: 'Tue  7 PM', url: '/register' })).toEqual({ title: 'New class: Bachata', body: 'Tue 7 PM', url: '/register' });
    expect(() => cleanMessage({ title: '', body: 'x', url: '/' })).toThrow('title');
    expect(() => cleanMessage({ title: 'x'.repeat(61), body: 'x', url: '/' })).toThrow('60 characters');
    expect(() => cleanMessage({ title: 'x', body: 'x'.repeat(181), url: '/' })).toThrow('180 characters');
    expect(() => cleanMessage({ title: 'x', body: 'x', url: 'https://evil.example' })).toThrow('page on this site');
  });
});

describe('sending', () => {
  beforeEach(() => {
    process.env.PUBLIC_VAPID_KEY = 'public';
    process.env.VAPID_PRIVATE_KEY = 'private';
    sendNotification.mockReset();
  });
  afterEach(() => {
    delete process.env.PUBLIC_VAPID_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  const row = (id: string, platform = 'android') => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}-${TOKEN}`, p256dh, auth, platform, created_at: '2026-11-01T00:00:00.000Z', last_sent_at: null });
  const message = { title: 'New class: Bachata', body: 'Tue 7 PM', url: '/register' };

  it('reaches every phone, removes the ones that are gone, keeps the ones refused for other reasons, and keeps a record', async () => {
    db.current = new FakeSupabase().seed('push_subscriptions', [row('a'), row('bb', 'ios'), row('ccc'), row('dddd', 'ios'), row('eeeee')]);
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.includes('/bb-')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (s.endpoint.includes('/ccc-')) throw Object.assign(new Error('busy'), { statusCode: 503 });
      // A refused key could be this site's mistake: never a reason to delete anyone.
      if (s.endpoint.includes('/eeeee-')) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
      return { statusCode: 201 };
    });

    const event = '11111111-1111-1111-1111-111111111111';
    const send = await startSend(message, { eventId: event, sentBy: 'b@example.com' });

    expect(send).toMatchObject({ delivered: 2, failed: 2, removed: 1, target: 5, event_id: event, sent_by: 'b@example.com' });
    expect(send.finished_at).toBeTruthy();
    expect(db.current.rows('push_subscriptions').map((s) => s.id).sort()).toEqual(['a', 'ccc', 'dddd', 'eeeee']);
    // Counted by the database, not by reading every subscription.
    expect(await subscriberCounts()).toEqual({ total: 4, ios: 1, android: 3, other: 0 });
    // The event is remembered, so sending about it again asks first (api/admin/push.ts).
    expect((await lastSendFor(event))?.title).toBe('New class: Bachata');

    const [, payload, options] = sendNotification.mock.calls[0];
    expect(JSON.parse(payload)).toEqual({ ...message, tag: event, id: send.id });
    expect(options.vapidDetails).toMatchObject({ publicKey: 'public', privateKey: 'private' });
    // Each push is given a short time, so a chunk always fits in one request.
    expect(options.timeout).toBeLessThanOrEqual(5000);
  });

  it('goes out a chunk per request, never trying a device twice, until every one is reached', async () => {
    const count = CHUNK + 10;
    db.current = new FakeSupabase().seed('push_subscriptions', Array.from({ length: count }, (_, i) => row(`s${String(i).padStart(3, '0')}`)));
    sendNotification.mockResolvedValue({ statusCode: 201 });

    const first = await startSend(message, { eventId: null, sentBy: null });
    expect(first).toMatchObject({ delivered: CHUNK, target: count, finished_at: null });

    const rest = await sendChunk(first.id);
    expect(rest.delivered).toBe(count);
    expect(rest.finished_at).toBeTruthy();
    const tried = sendNotification.mock.calls.map(([s]) => (s as { endpoint: string }).endpoint);
    expect(new Set(tried).size).toBe(count);
    expect(tried).toHaveLength(count);

    // Continuing a finished send does nothing.
    expect((await sendChunk(first.id)).delivered).toBe(count);
    expect(sendNotification).toHaveBeenCalledTimes(count);
  });

  it("refuses to send before the keys are set up", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    db.current = new FakeSupabase().seed('push_subscriptions', [row('a')]);
    await expect(startSend(message, { eventId: null, sentBy: null })).rejects.toThrow('VAPID_PRIVATE_KEY');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
