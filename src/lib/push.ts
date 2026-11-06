import webpush from 'web-push';
import { supabase } from './supabase';
import { env } from './env';
import { fetchAllRows } from './fetchAll';
import { fakePush } from './testMode';

// Push notifications: phones turn them on from the header bell
// (components/InstallApp.astro, api/push.ts); admins send from
// /admin/notifications (api/admin/push.ts). Stored in push_subscriptions and
// push_sends (migration 0069). The test suite (E2E_FAKE_PUSH) keeps both in
// memory and sends nothing, so a run never reaches a real phone.

export type Platform = 'ios' | 'android' | 'other';

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: Platform;
}

export interface PushMessage {
  title: string;
  body: string;
  // A page on this site, as a path ("/register").
  url: string;
}

export interface PushSend extends PushMessage {
  id: string;
  created_at: string;
  sent_by: string | null;
  event_id: string | null;
  delivered: number;
  failed: number;
  removed: number;
  // Reported by the devices (public/sw.js): how many showed it, and how many were tapped.
  shown: number;
  opened: number;
}

export const MAX_TITLE = 60;
export const MAX_BODY = 180;
const MAX_URL = 300;

export class PushError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

export const pushConfigured = () => Boolean(env('PUBLIC_VAPID_KEY') && env('VAPID_PRIVATE_KEY'));

// The push services browsers use. Anything else is refused, so a made-up
// "subscription" can never make this server call some other address.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

const isKey = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && BASE64URL.test(value);

// A browser's PushSubscription (as JSON), or null when it isn't one.
export function cleanSubscription(raw: unknown, platform: unknown): PushSubscriptionRow | null {
  const sub = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!sub || !isPushEndpoint(sub.endpoint)) return null;
  const { p256dh, auth } = sub.keys ?? {};
  if (!isKey(p256dh, 80, 100) || !isKey(auth, 16, 30)) return null;
  return { endpoint: sub.endpoint, p256dh, auth, platform: platform === 'ios' || platform === 'android' ? platform : 'other' };
}

// A path on this site: "/register", or a full dancewithb.fun address made into one.
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  const own = /^https?:\/\/(www\.)?dancewithb\.fun(?=\/|$)/i;
  if (own.test(value)) value = value.replace(own, '') || '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > MAX_URL) return null;
  return /^[\x21-\x7e]+$/.test(value) ? value : null;
}

export function cleanMessage(raw: unknown): PushMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const title = text(m.title);
  const body = text(m.body);
  const url = cleanPath(m.url ?? '/');
  if (!title) throw new PushError('Give the notification a title.');
  if (title.length > MAX_TITLE) throw new PushError(`Keep the title to ${MAX_TITLE} characters (phones cut off the rest).`);
  if (!body) throw new PushError('Write the message.');
  if (body.length > MAX_BODY) throw new PushError(`Keep the message to ${MAX_BODY} characters (phones cut off the rest).`);
  if (!url) throw new PushError('The link has to be a page on this site, like /register.');
  return { title, body, url };
}

// ---- Storage (or memory, for the test suite) ----

const memory = { subscriptions: [] as PushSubscriptionRow[], sends: [] as PushSend[] };

const storeError = (message: string) =>
  new PushError(`Couldn't reach the notification list: ${message}.${/push_s/.test(message) ? ' Run migration 0069 in Supabase first.' : ''}`, 500);

export async function saveSubscription(sub: PushSubscriptionRow): Promise<void> {
  if (fakePush()) {
    memory.subscriptions = [...memory.subscriptions.filter((s) => s.endpoint !== sub.endpoint), sub];
    return;
  }
  // The endpoint is unique: a phone turning them on again just refreshes its keys.
  const { error } = await supabase.from('push_subscriptions').upsert(sub, { onConflict: 'endpoint' });
  if (error) throw storeError(error.message);
}

// Only the phone itself can remove its subscription: it has to know its own key too.
export async function removeSubscription(endpoint: string, auth: string): Promise<void> {
  if (fakePush()) {
    memory.subscriptions = memory.subscriptions.filter((s) => !(s.endpoint === endpoint && s.auth === auth));
    return;
  }
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('auth', auth);
  if (error) throw storeError(error.message);
}

async function allSubscriptions(): Promise<(PushSubscriptionRow & { id: string })[]> {
  if (fakePush()) return memory.subscriptions.map((s) => ({ ...s, id: s.endpoint }));
  try {
    return await fetchAllRows<PushSubscriptionRow & { id: string }>((from, to) =>
      supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth, platform').order('created_at').order('id').range(from, to)
    );
  } catch (e) {
    throw storeError(e instanceof Error ? e.message : String(e));
  }
}

export async function subscriberCounts(): Promise<Record<Platform | 'total', number>> {
  const subs = await allSubscriptions();
  const count = (p: Platform) => subs.filter((s) => s.platform === p).length;
  return { total: subs.length, ios: count('ios'), android: count('android'), other: count('other') };
}

export async function recentSends(limit = 50): Promise<PushSend[]> {
  if (fakePush()) return memory.sends.slice(0, limit);
  const { data, error } = await supabase.from('push_sends').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw storeError(error.message);
  return (data ?? []) as PushSend[];
}

export async function lastSendFor(eventId: string): Promise<PushSend | null> {
  if (fakePush()) return memory.sends.find((s) => s.event_id === eventId) ?? null;
  const { data, error } = await supabase.from('push_sends').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(1);
  if (error) throw storeError(error.message);
  return ((data ?? [])[0] as PushSend | undefined) ?? null;
}

// Saved before sending, so a device that shows it at once can already be counted;
// `delivered` starts at the most it can be (it caps the device counts) and is set after.
async function startSend(send: Omit<PushSend, 'id' | 'created_at' | 'shown' | 'opened'>): Promise<PushSend> {
  const row = { ...send, shown: 0, opened: 0 };
  if (fakePush()) {
    const saved = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    memory.sends.unshift(saved);
    return saved;
  }
  const { data, error } = await supabase.from('push_sends').insert(send).select('*').single();
  if (error) throw storeError(error.message);
  return data as PushSend;
}

async function finishSend(id: string, counts: Pick<PushSend, 'delivered' | 'failed' | 'removed'>): Promise<PushSend> {
  if (fakePush()) {
    const saved = memory.sends.find((s) => s.id === id)!;
    Object.assign(saved, counts);
    return { ...saved };
  }
  const { data, error } = await supabase.from('push_sends').update(counts).eq('id', id).select('*').single();
  if (error) throw storeError(error.message);
  return data as PushSend;
}

export type DeviceReport = 'shown' | 'opened';

// A device showed a notification, or someone tapped it (api/push.ts). Only the
// send's id is reported; neither count can pass `delivered` (migration 0070).
export async function countReport(sendId: string, kind: DeviceReport): Promise<boolean> {
  if (fakePush()) {
    const send = memory.sends.find((s) => s.id === sendId);
    if (!send) return false;
    send[kind] = Math.min(send[kind] + 1, send.delivered);
    return true;
  }
  const { data, error } = await supabase.rpc('count_push_send', { p_id: sendId, p_kind: kind });
  if (error) throw storeError(error.message);
  return data === true;
}

// ---- Sending ----

const BATCH = 50;
const ID_CHUNK = 100;

type Outcome = 'delivered' | 'gone' | 'failed';

async function deliver(sub: PushSubscriptionRow, payload: string): Promise<Outcome> {
  if (fakePush()) return sub.endpoint.includes('/gone') ? 'gone' : 'delivered';
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      TTL: 60 * 60 * 24,
      vapidDetails: { subject: env('VAPID_SUBJECT') || 'https://dancewithb.fun', publicKey: env('PUBLIC_VAPID_KEY')!, privateKey: env('VAPID_PRIVATE_KEY')! },
      timeout: 10_000,
    });
    return 'delivered';
  } catch (e) {
    // The phone unsubscribed, or the app was removed: the push service says it's gone.
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}

async function forget(ids: string[]): Promise<void> {
  if (fakePush()) {
    memory.subscriptions = memory.subscriptions.filter((s) => !ids.includes(s.endpoint));
    return;
  }
  for (let i = 0; i < ids.length; i += ID_CHUNK) await supabase.from('push_subscriptions').delete().in('id', ids.slice(i, i + ID_CHUNK));
}

async function markSent(ids: string[]): Promise<void> {
  if (fakePush() || ids.length === 0) return;
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += ID_CHUNK) await supabase.from('push_subscriptions').update({ last_sent_at: now }).in('id', ids.slice(i, i + ID_CHUNK));
}

// Sends to every subscribed phone, removes the ones that are gone, and keeps a record.
export async function sendToAll(message: PushMessage, options: { eventId: string | null; sentBy: string | null }): Promise<PushSend> {
  if (!pushConfigured() && !fakePush()) throw new PushError('Push notifications aren’t set up: add PUBLIC_VAPID_KEY and VAPID_PRIVATE_KEY in Netlify.', 500);
  const subs = await allSubscriptions();
  const send = await startSend({ ...message, event_id: options.eventId, sent_by: options.sentBy, delivered: subs.length, failed: 0, removed: 0 });
  // The tag lets a resent message replace the earlier one on the phone instead of stacking;
  // the id is what the device reports back when it shows or opens it.
  const payload = JSON.stringify({ ...message, tag: options.eventId ?? send.id, id: send.id });
  const delivered: string[] = [];
  const gone: string[] = [];
  let failed = 0;
  for (let i = 0; i < subs.length; i += BATCH) {
    const batch = subs.slice(i, i + BATCH);
    const outcomes = await Promise.all(batch.map((s) => deliver(s, payload)));
    outcomes.forEach((outcome, j) => {
      if (outcome === 'delivered') delivered.push(batch[j].id);
      else if (outcome === 'gone') gone.push(batch[j].id);
      else failed++;
    });
  }
  await forget(gone);
  await markSent(delivered);
  return finishSend(send.id, { delivered: delivered.length, failed, removed: gone.length });
}
