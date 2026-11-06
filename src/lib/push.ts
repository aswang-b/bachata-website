import webpush from 'web-push';
import { supabase } from './supabase';
import { env } from './env';
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
  // How many devices it was for, and when it reached them all (null while it's still going, or stopped).
  target: number | null;
  finished_at: string | null;
}

// A subscription as stored: when it was made, and when a send last tried it.
type Subscribed = PushSubscriptionRow & { id: string; created_at: string; last_sent_at: string | null };

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

// The push services browsers use, each with the shape of its own addresses.
// Anything else is refused, so a made-up "subscription" can never make this
// server call some other address (or anything on those hosts but a push).
const PUSH_SERVICES: { host: RegExp; path: RegExp }[] = [
  { host: /^fcm\.googleapis\.com$/, path: /^\/(fcm\/send|wp)\/[\w:-]{20,}$/ },
  { host: /^([a-z0-9-]+\.)*push\.apple\.com$/, path: /^\/[\w-]{20,}$/ },
  { host: /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, path: /^\/wpush\/v[12]\/[\w=-]{20,}$/ },
  { host: /^([a-z0-9-]+\.)*notify\.windows\.com$/, path: /^\/w\/$/ },
];
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.hash && PUSH_SERVICES.some((p) => p.host.test(url.hostname) && p.path.test(url.pathname));
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

const memory = { subscriptions: [] as Subscribed[], sends: [] as PushSend[] };

const storeError = (message: string) =>
  new PushError(`Couldn't reach the notification list: ${message}.${/push_s/.test(message) ? ' Run migration 0069 in Supabase first.' : ''}`, 500);

export async function saveSubscription(sub: PushSubscriptionRow): Promise<void> {
  if (fakePush()) {
    const before = memory.subscriptions.find((s) => s.endpoint === sub.endpoint);
    const kept = { id: before?.id ?? crypto.randomUUID(), created_at: before?.created_at ?? new Date().toISOString(), last_sent_at: before?.last_sent_at ?? null };
    memory.subscriptions = [...memory.subscriptions.filter((s) => s.endpoint !== sub.endpoint), { ...sub, ...kept }];
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

export async function subscriberCounts(): Promise<Record<Platform | 'total', number>> {
  if (fakePush()) {
    const count = (p: Platform) => memory.subscriptions.filter((s) => s.platform === p).length;
    return { total: memory.subscriptions.length, ios: count('ios'), android: count('android'), other: count('other') };
  }
  // Counted by the database, not by reading every subscription.
  const count = async (platform?: Platform) => {
    let query = supabase.from('push_subscriptions').select('id', { count: 'exact', head: true });
    if (platform) query = query.eq('platform', platform);
    const { count: n, error } = await query;
    if (error) throw storeError(error.message);
    return n ?? 0;
  };
  const [total, ios, android, other] = await Promise.all([count(), count('ios'), count('android'), count('other')]);
  return { total, ios, android, other };
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

async function getSend(id: string): Promise<PushSend | null> {
  if (fakePush()) return memory.sends.find((s) => s.id === id) ?? null;
  const { data, error } = await supabase.from('push_sends').select('*').eq('id', id).maybeSingle();
  if (error) throw storeError(error.message);
  return (data as PushSend | null) ?? null;
}

export type DeviceReport = 'shown' | 'opened';

// A device showed a notification, or someone tapped it (api/push.ts). Only the
// send's id is reported; neither count can pass the send's target (migration 0073).
export async function countReport(sendId: string, kind: DeviceReport): Promise<boolean> {
  if (fakePush()) {
    const send = memory.sends.find((s) => s.id === sendId);
    if (!send) return false;
    send[kind] = Math.min(send[kind] + 1, send.target ?? send.delivered);
    return true;
  }
  const { data, error } = await supabase.rpc('count_push_send', { p_id: sendId, p_kind: kind });
  if (error) throw storeError(error.message);
  return data === true;
}

// ---- Sending, a chunk per request ----
// No request can run past the hosting's time limit: each sends to at most
// CHUNK devices at once (each given PUSH_TIMEOUT_MS), and the admin page asks
// for the next chunk until the send is finished (api/admin/push.ts). A device
// is claimed (its last_sent_at set) before it's sent to, so no chunk, or a
// second tab continuing the same send, tries it twice.

export const CHUNK = 150;
const PUSH_TIMEOUT_MS = 5_000;
const ID_CHUNK = 100;

type Outcome = 'delivered' | 'gone' | 'failed';

async function deliver(sub: PushSubscriptionRow, payload: string): Promise<Outcome> {
  if (fakePush()) return sub.endpoint.includes('/gone') ? 'gone' : 'delivered';
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      TTL: 60 * 60 * 24,
      vapidDetails: { subject: env('VAPID_SUBJECT') || 'https://dancewithb.fun', publicKey: env('PUBLIC_VAPID_KEY')!, privateKey: env('VAPID_PRIVATE_KEY')! },
      timeout: PUSH_TIMEOUT_MS,
    });
    return 'delivered';
  } catch (e) {
    // The phone unsubscribed, or the app was removed: the push service says it's gone.
    // (Not 401/403: those can mean a mistake in this site's keys, and must never empty the list.)
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}

// The next devices this send hasn't tried, claimed for this chunk.
async function claimChunk(send: PushSend): Promise<Subscribed[]> {
  const now = new Date().toISOString();
  const due = (s: Pick<Subscribed, 'created_at' | 'last_sent_at'>) => s.created_at <= send.created_at && (!s.last_sent_at || s.last_sent_at < send.created_at);
  if (fakePush()) {
    const chunk = memory.subscriptions.filter(due).slice(0, CHUNK);
    chunk.forEach((s) => (s.last_sent_at = now));
    return chunk.map((s) => ({ ...s }));
  }
  const notTried = `last_sent_at.is.null,last_sent_at.lt.${send.created_at}`;
  const { data, error } = await supabase.from('push_subscriptions').select('id').lte('created_at', send.created_at).or(notTried).order('id').limit(CHUNK);
  if (error) throw storeError(error.message);
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) return [];
  // Only the ones still unclaimed come back, so a second request never gets the same device.
  const claimed = await supabase
    .from('push_subscriptions')
    .update({ last_sent_at: now })
    .in('id', ids)
    .or(notTried)
    .select('id, endpoint, p256dh, auth, platform, created_at, last_sent_at');
  if (claimed.error) throw storeError(claimed.error.message);
  return (claimed.data ?? []) as Subscribed[];
}

async function forget(ids: string[]): Promise<void> {
  if (fakePush()) {
    memory.subscriptions = memory.subscriptions.filter((s) => !ids.includes(s.id));
    return;
  }
  for (let i = 0; i < ids.length; i += ID_CHUNK) await supabase.from('push_subscriptions').delete().in('id', ids.slice(i, i + ID_CHUNK));
}

// Sends the next chunk and adds it to the send's counts; `finished_at` is set
// once no device is left. Safe to call again on a finished send.
export async function sendChunk(sendId: string): Promise<PushSend> {
  if (!pushConfigured() && !fakePush()) throw new PushError('Push notifications aren’t set up: add PUBLIC_VAPID_KEY and VAPID_PRIVATE_KEY in Netlify.', 500);
  const send = await getSend(sendId);
  if (!send) throw new PushError('That notification wasn’t found.', 404);
  if (send.finished_at) return send;
  const subs = await claimChunk(send);
  // The tag lets a resent message replace the earlier one on the phone instead of stacking;
  // the id is what the device reports back when it shows or opens it.
  const payload = JSON.stringify({ title: send.title, body: send.body, url: send.url, tag: send.event_id ?? send.id, id: send.id });
  const outcomes = await Promise.all(subs.map((s) => deliver(s, payload)));
  const gone = subs.filter((_, i) => outcomes[i] === 'gone').map((s) => s.id);
  await forget(gone);
  const fresh = (await getSend(sendId)) ?? send;
  const counts = {
    delivered: fresh.delivered + outcomes.filter((o) => o === 'delivered').length,
    failed: fresh.failed + outcomes.filter((o) => o === 'failed').length,
    removed: fresh.removed + gone.length,
    finished_at: subs.length < CHUNK ? new Date().toISOString() : null,
  };
  if (fakePush()) {
    Object.assign(memory.sends.find((s) => s.id === sendId)!, counts);
    return { ...fresh, ...counts };
  }
  const { data, error } = await supabase.from('push_sends').update(counts).eq('id', sendId).select('*').single();
  if (error) throw storeError(error.message);
  return data as PushSend;
}

// Records the send (for every device subscribed now) and sends its first chunk.
export async function startSend(message: PushMessage, options: { eventId: string | null; sentBy: string | null }): Promise<PushSend> {
  if (!pushConfigured() && !fakePush()) throw new PushError('Push notifications aren’t set up: add PUBLIC_VAPID_KEY and VAPID_PRIVATE_KEY in Netlify.', 500);
  const { total } = await subscriberCounts();
  const row = { ...message, event_id: options.eventId, sent_by: options.sentBy, delivered: 0, failed: 0, removed: 0, target: total, finished_at: null };
  let send: PushSend;
  if (fakePush()) {
    send = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString(), shown: 0, opened: 0 };
    memory.sends.unshift(send);
  } else {
    const { data, error } = await supabase.from('push_sends').insert(row).select('*').single();
    if (error) throw storeError(`${error.message}${/target|finished_at/.test(error.message) ? '. Run migration 0073 in Supabase first' : ''}`);
    send = data as PushSend;
  }
  return sendChunk(send.id);
}
